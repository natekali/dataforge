"""AI-powered dataset enhancement endpoints."""


from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from dataforge_api import database as db
from dataforge_api.config import settings

router = APIRouter()


class EnhancementConfig(BaseModel):
    """Configuration for AI enhancement."""

    provider: str = "ollama"  # ollama, openai, anthropic
    model: str = "llama3.2"
    operations: list[str] = ["improve_quality"]
    batch_size: int = 10
    temperature: float = 0.7
    max_tokens: int = 2048


class GenerationConfig(BaseModel):
    """Configuration for synthetic data generation."""

    provider: str = "ollama"
    model: str = "llama3.2"
    num_examples: int = 10
    technique: str = "evol_instruct"  # evol_instruct, persona, seed_expansion
    seed_examples: list[dict] | None = None
    topics: list[str] | None = None
    personas: list[str] | None = None
    temperature: float = 0.8
    diversity: float = 0.7


class EnhancementResult(BaseModel):
    """Result of enhancement operation."""

    job_id: str
    status: str
    processed: int
    total: int
    improved: int


class GenerationResult(BaseModel):
    """Result of generation operation."""

    job_id: str
    status: str
    generated: int
    target: int


# Enhancement prompts
ENHANCEMENT_PROMPTS = {
    "improve_quality": """Improve the following assistant response to be more helpful, accurate, and well-structured.

Original instruction: {instruction}
Original response: {response}

Requirements:
- Keep the same general approach and information
- Make it more comprehensive and clear
- Add relevant details or examples where appropriate
- Ensure proper formatting
- Do not add unnecessary filler or repetition

Improved response:""",

    "add_reasoning": """Add step-by-step reasoning to the following response. Use <thinking> tags for internal reasoning.

Instruction: {instruction}
Response: {response}

Format your response as:
<thinking>
[Your reasoning process here]
</thinking>

[Final answer here]

Enhanced response with reasoning:""",

    "expand_response": """Expand the following response to be more detailed and comprehensive.

Instruction: {instruction}
Response: {response}

Expanded response (add relevant details, examples, and explanations):""",

    "add_code_examples": """If the following response would benefit from code examples, add well-commented, runnable code.

Instruction: {instruction}
Response: {response}

Enhanced response with code examples:""",

    "simplify": """Simplify the following response to be clearer and more accessible.

Instruction: {instruction}
Response: {response}

Simplified response:""",
}

# Generation prompts
GENERATION_PROMPTS = {
    "evol_instruct": """Generate a new, more complex instruction based on this seed:

Seed instruction: {seed_instruction}

Create a variation that is:
- More specific or detailed
- Requires deeper reasoning
- Covers edge cases or nuances

New instruction:""",

    "persona": """You are {persona}. Generate a realistic question or instruction that someone with this background might ask.

Topic area: {topic}

Generate an instruction that reflects this persona's knowledge level and interests:""",

    "seed_expansion": """Based on this example, generate a similar but different training example:

Example instruction: {seed_instruction}
Example response: {seed_response}

Generate a new, related example with different specifics but similar style and depth.

New instruction:""",
}


async def _get_llm_client(provider: str, model: str):
    """Get LiteLLM client configuration."""
    import litellm

    if provider == "ollama":
        litellm.api_base = settings.ollama_base_url
        return f"ollama/{model}"
    elif provider == "openai":
        if not settings.openai_api_key:
            raise HTTPException(status_code=400, detail="OpenAI API key not configured")
        litellm.api_key = settings.openai_api_key
        return model
    elif provider == "anthropic":
        if not settings.anthropic_api_key:
            raise HTTPException(status_code=400, detail="Anthropic API key not configured")
        litellm.api_key = settings.anthropic_api_key
        return model
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


async def _call_llm(model_name: str, prompt: str, temperature: float, max_tokens: int) -> str:
    """Call LLM and return response."""
    from litellm import acompletion

    try:
        response = await acompletion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM call failed: {str(e)}") from e


@router.post("/{project_id}/improve", response_model=EnhancementResult)
async def enhance_dataset(
    project_id: str,
    config: EnhancementConfig,
    background_tasks: BackgroundTasks,
) -> EnhancementResult:
    """
    Enhance dataset using AI to improve response quality.

    Available operations:
    - improve_quality: General quality improvement
    - add_reasoning: Add step-by-step reasoning
    - expand_response: Make responses more detailed
    - add_code_examples: Add code where relevant
    - simplify: Make responses clearer
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create job
    job = await db.create_job(project_id, "enhance")

    # Start background task
    background_tasks.add_task(
        _run_enhancement,
        job["id"],
        project_id,
        config,
    )

    example_count = await db.count_examples(project_id)

    return EnhancementResult(
        job_id=job["id"],
        status="running",
        processed=0,
        total=example_count,
        improved=0,
    )


async def _run_enhancement(job_id: str, project_id: str, config: EnhancementConfig):
    """Background task to run enhancement."""
    try:
        model_name = await _get_llm_client(config.provider, config.model)
        examples = await db.get_examples(project_id, offset=0, limit=100000)

        processed = 0
        improved = 0

        for op in config.operations:
            if op not in ENHANCEMENT_PROMPTS:
                continue

            prompt_template = ENHANCEMENT_PROMPTS[op]

            for i in range(0, len(examples), config.batch_size):
                batch = examples[i : i + config.batch_size]

                for ex in batch:
                    messages = ex["messages"]

                    # Find user and assistant messages
                    instruction = ""
                    response = ""
                    assistant_idx = -1

                    for j, msg in enumerate(messages):
                        if msg["role"] == "user":
                            instruction = msg["content"]
                        elif msg["role"] == "assistant":
                            response = msg["content"]
                            assistant_idx = j

                    if not instruction or not response or assistant_idx < 0:
                        continue

                    # Generate improved response
                    prompt = prompt_template.format(
                        instruction=instruction,
                        response=response,
                    )

                    try:
                        improved_response = await _call_llm(
                            model_name,
                            prompt,
                            config.temperature,
                            config.max_tokens,
                        )

                        # Update the assistant message
                        messages[assistant_idx]["content"] = improved_response.strip()
                        await db.update_example(ex["id"], messages=messages)
                        improved += 1

                    except Exception:
                        pass  # Skip failed examples

                    processed += 1

                # Update job progress
                await db.update_job(
                    job_id,
                    progress=processed / len(examples),
                    result={"processed": processed, "improved": improved},
                )

        await db.update_job(
            job_id,
            status="completed",
            progress=1.0,
            result={"processed": processed, "improved": improved},
        )

    except Exception as e:
        await db.update_job(job_id, status="failed", error=str(e))


@router.post("/{project_id}/generate", response_model=GenerationResult)
async def generate_synthetic_data(
    project_id: str,
    config: GenerationConfig,
    background_tasks: BackgroundTasks,
) -> GenerationResult:
    """
    Generate synthetic training data using AI.

    Techniques:
    - evol_instruct: Evolve instructions to be more complex
    - persona: Generate from different user personas
    - seed_expansion: Create variations of seed examples
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Create job
    job = await db.create_job(project_id, "generate")

    # Start background task
    background_tasks.add_task(
        _run_generation,
        job["id"],
        project_id,
        config,
    )

    return GenerationResult(
        job_id=job["id"],
        status="running",
        generated=0,
        target=config.num_examples,
    )


async def _run_generation(job_id: str, project_id: str, config: GenerationConfig):
    """Background task to run synthetic generation."""
    try:
        model_name = await _get_llm_client(config.provider, config.model)

        generated = 0
        new_examples = []

        # Get seed examples if not provided
        if config.seed_examples:
            seeds = config.seed_examples
        else:
            examples = await db.get_examples(project_id, offset=0, limit=20)
            seeds = [{"messages": ex["messages"]} for ex in examples]

        if not seeds:
            await db.update_job(job_id, status="failed", error="No seed examples available")
            return

        # Default topics and personas
        topics = config.topics or ["general knowledge", "coding", "analysis", "explanation", "problem solving"]
        personas = config.personas or [
            "a curious student learning programming",
            "a professional software developer",
            "a researcher exploring new concepts",
            "a business analyst seeking insights",
            "a creative writer looking for ideas",
        ]

        while generated < config.num_examples:
            if config.technique == "evol_instruct":
                # Evolve existing instructions
                seed = seeds[generated % len(seeds)]
                seed_instruction = ""
                for msg in seed.get("messages", []):
                    if msg["role"] == "user":
                        seed_instruction = msg["content"]
                        break

                prompt = GENERATION_PROMPTS["evol_instruct"].format(
                    seed_instruction=seed_instruction
                )

            elif config.technique == "persona":
                # Generate from personas
                persona = personas[generated % len(personas)]
                topic = topics[generated % len(topics)]

                prompt = GENERATION_PROMPTS["persona"].format(
                    persona=persona,
                    topic=topic,
                )

            elif config.technique == "seed_expansion":
                seed = seeds[generated % len(seeds)]
                seed_instruction = ""
                seed_response = ""
                for msg in seed.get("messages", []):
                    if msg["role"] == "user":
                        seed_instruction = msg["content"]
                    elif msg["role"] == "assistant":
                        seed_response = msg["content"]

                prompt = GENERATION_PROMPTS["seed_expansion"].format(
                    seed_instruction=seed_instruction,
                    seed_response=seed_response,
                )
            else:
                prompt = GENERATION_PROMPTS["evol_instruct"].format(
                    seed_instruction=seeds[0].get("messages", [{}])[0].get("content", "")
                )

            try:
                # Generate new instruction
                new_instruction = await _call_llm(
                    model_name,
                    prompt,
                    config.temperature,
                    512,
                )

                # Generate response for new instruction
                response_prompt = f"Respond helpfully and accurately to: {new_instruction.strip()}"
                new_response = await _call_llm(
                    model_name,
                    response_prompt,
                    config.temperature - 0.1,  # Slightly lower temp for responses
                    config.max_tokens if hasattr(config, 'max_tokens') else 1024,
                )

                # Create new example
                new_example = {
                    "messages": [
                        {"role": "user", "content": new_instruction.strip()},
                        {"role": "assistant", "content": new_response.strip()},
                    ],
                    "metadata": {
                        "synthetic": True,
                        "technique": config.technique,
                        "model": config.model,
                    },
                }
                new_examples.append(new_example)
                generated += 1

            except Exception:
                pass  # Skip failed generations

            # Update progress
            await db.update_job(
                job_id,
                progress=generated / config.num_examples,
                result={"generated": generated},
            )

        # Add generated examples to database
        if new_examples:
            await db.add_examples(project_id, new_examples)

        await db.update_job(
            job_id,
            status="completed",
            progress=1.0,
            result={"generated": generated},
        )

    except Exception as e:
        await db.update_job(job_id, status="failed", error=str(e))


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> dict:
    """Get status of an enhancement or generation job."""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "id": job["id"],
        "type": job["job_type"],
        "status": job["status"],
        "progress": job["progress"],
        "result": job.get("result"),
        "error": job.get("error"),
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }


@router.post("/{project_id}/preview-enhancement")
async def preview_enhancement(
    project_id: str,
    config: EnhancementConfig,
    example_ids: list[str] | None = None,
) -> dict:
    """
    Preview enhancement on a few examples without saving.
    """
    project = await db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    model_name = await _get_llm_client(config.provider, config.model)

    # Get examples to preview
    if example_ids:
        examples = [await db.get_example(eid) for eid in example_ids[:3]]
        examples = [ex for ex in examples if ex]
    else:
        examples = await db.get_examples(project_id, offset=0, limit=3)

    if not examples:
        return {"previews": []}

    previews = []

    for ex in examples:
        messages = ex["messages"]
        instruction = ""
        response = ""

        for msg in messages:
            if msg["role"] == "user":
                instruction = msg["content"]
            elif msg["role"] == "assistant":
                response = msg["content"]

        if not instruction or not response:
            continue

        preview = {"example_id": ex["id"], "original": response, "enhanced": {}}

        for op in config.operations[:2]:  # Limit operations for preview
            if op not in ENHANCEMENT_PROMPTS:
                continue

            prompt = ENHANCEMENT_PROMPTS[op].format(
                instruction=instruction,
                response=response,
            )

            try:
                enhanced = await _call_llm(
                    model_name,
                    prompt,
                    config.temperature,
                    config.max_tokens,
                )
                preview["enhanced"][op] = enhanced.strip()
            except Exception as e:
                preview["enhanced"][op] = f"Error: {str(e)}"

        previews.append(preview)

    return {"previews": previews}
