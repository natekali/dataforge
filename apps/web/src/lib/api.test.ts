import { describe, it, expect, vi, beforeEach } from 'vitest'
import { projectsApi, datasetsApi, modelsApi, ApiError } from './api'

describe('API Client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('projectsApi', () => {
    it('should list projects', async () => {
      const mockProjects = [
        { id: '1', name: 'Project 1', created_at: '2024-01-01', updated_at: '2024-01-01' },
        { id: '2', name: 'Project 2', created_at: '2024-01-02', updated_at: '2024-01-02' },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      })

      const result = await projectsApi.list()
      
      expect(result).toEqual(mockProjects)
      expect(fetch).toHaveBeenCalledWith('/api/v1/projects')
    })

    it('should create a project', async () => {
      const newProject = { name: 'Test Project', description: 'A test' }
      const mockResponse = { id: '123', ...newProject, created_at: '2024-01-01', updated_at: '2024-01-01' }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await projectsApi.create(newProject)
      
      expect(result).toEqual(mockResponse)
      expect(fetch).toHaveBeenCalledWith('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      })
    })

    it('should throw ApiError on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Not found' }),
      })

      await expect(projectsApi.get('nonexistent')).rejects.toThrow(ApiError)
    })
  })

  describe('modelsApi', () => {
    it('should list model families', async () => {
      const mockFamilies = [
        { id: 'llama', name: 'Llama', models: [] },
        { id: 'qwen', name: 'Qwen', models: [] },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFamilies),
      })

      const result = await modelsApi.listFamilies()
      
      expect(result).toEqual(mockFamilies)
      expect(fetch).toHaveBeenCalledWith('/api/v1/models')
    })
  })

  describe('datasetsApi', () => {
    it('should get examples with pagination', async () => {
      const mockExamples = [
        { id: '1', messages: [{ role: 'user', content: 'Hi' }] },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockExamples),
      })

      const result = await datasetsApi.getExamples('project-1', { limit: 10, offset: 0 })
      
      expect(result).toEqual(mockExamples)
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/datasets/project-1/examples'))
    })

    it('should import file', async () => {
      const mockResult = { success: true, imported: 5, detected_schema: { format: 'chatml' } }
      const file = new File(['test'], 'test.jsonl', { type: 'application/jsonl' })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      })

      const result = await datasetsApi.importFile('project-1', file)
      
      expect(result).toEqual(mockResult)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/datasets/project-1/import'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
