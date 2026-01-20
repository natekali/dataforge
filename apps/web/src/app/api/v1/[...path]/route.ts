/**
 * API Proxy Route
 *
 * Proxies all /api/v1/* requests to the backend API server.
 * This is more reliable than Next.js rewrites in standalone mode.
 * Includes retry logic for transient connection errors.
 */

import { NextRequest, NextResponse } from 'next/server';

// Backend API URL - use Docker service name in production
const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8000';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 120000; // 2 minutes

function isRetryableError(error: Error): boolean {
  const message = error.message || '';
  return (
    message.includes('ECONNRESET') ||
    message.includes('socket hang up') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT') ||
    message.includes('fetch failed')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function proxyRequest(request: NextRequest, path: string) {
  const url = `${API_URL}/api/v1/${path}`;

  // Get request body for non-GET requests
  let body: BodyInit | null = null;
  let bodyForRetry: string | Blob | null = null;
  const contentType = request.headers.get('content-type') || '';

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (contentType.includes('multipart/form-data')) {
      // For file uploads, pass the body as-is
      bodyForRetry = await request.blob();
      body = bodyForRetry;
    } else if (contentType.includes('application/json')) {
      bodyForRetry = await request.text();
      body = bodyForRetry;
    } else {
      bodyForRetry = await request.blob();
      body = bodyForRetry;
    }
  }

  // Build headers, excluding host
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      headers.set(key, value);
    }
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Set a longer timeout for slow first requests (API may need to initialize)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        method: request.method,
        headers,
        body: attempt === 0 ? body : bodyForRetry,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Get response body
      const responseBody = await response.arrayBuffer();

      // Build response headers
      const responseHeaders = new Headers();
      response.headers.forEach((value, key) => {
        // Skip headers that Next.js will set
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      });

      return new NextResponse(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on connection errors, not on timeouts
      if (lastError.name === 'AbortError') {
        // Timeout - don't retry
        break;
      }

      if (isRetryableError(lastError) && attempt < MAX_RETRIES - 1) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.log(`Proxy request to ${url} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`, lastError.message);
        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries reached
      break;
    }
  }

  // All retries exhausted or non-retryable error
  console.error(`Failed to proxy ${url} after ${MAX_RETRIES} attempts`, lastError);

  // Determine error type and message
  let detail = 'Backend API is not reachable';
  let status = 503;

  if (lastError) {
    if (lastError.name === 'AbortError') {
      detail = 'Request timeout - API took too long to respond';
      status = 504;
    } else if (lastError.message.includes('ECONNREFUSED')) {
      detail = 'Cannot connect to backend API - is it running?';
    } else if (lastError.message.includes('ECONNRESET') || lastError.message.includes('socket hang up')) {
      detail = 'Connection to backend API was reset - API may be restarting or overloaded';
    }
  }

  return NextResponse.json(
    {
      detail,
      error: lastError?.message || 'Unknown error',
      url: url,
    },
    { status }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return proxyRequest(request, path.join('/'));
}
