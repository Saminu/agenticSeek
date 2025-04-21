#!/usr/bin/env python3

import os, sys
import uvicorn
import aiofiles
import configparser
import asyncio
import time
from typing import List
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from sources.llm_provider import Provider
from sources.interaction import Interaction
from sources.agents import CasualAgent, CoderAgent, FileAgent, PlannerAgent, BrowserAgent
from sources.browser import Browser, create_driver
from sources.utility import pretty_print
from sources.logger import Logger
from sources.schemas import QueryRequest, QueryResponse

from celery import Celery

# Load environment variables
load_dotenv()

api = FastAPI(title="AgenticSeek API", version="0.1.0")

# Get Redis URL from environment variable or use default
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("tasks", broker=redis_url, backend=redis_url)
celery_app.conf.update(task_track_started=True)
logger = Logger("backend.log")
config = configparser.ConfigParser()
config.read('config.ini')

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not os.path.exists(".screenshots"):
    os.makedirs(".screenshots")
api.mount("/screenshots", StaticFiles(directory=".screenshots"), name="screenshots")

def initialize_system():
    stealth_mode = config.getboolean('BROWSER', 'stealth_mode')
    personality_folder = "jarvis" if config.getboolean('MAIN', 'jarvis_personality') else "base"
    languages = config["MAIN"]["languages"].split(' ')

    provider = Provider(
        provider_name=config["MAIN"]["provider_name"],
        model=config["MAIN"]["provider_model"],
        server_address=config["MAIN"]["provider_server_address"],
        is_local=config.getboolean('MAIN', 'is_local')
    )
    logger.info(f"Provider initialized: {provider.provider_name} ({provider.model})")

    browser = Browser(
        create_driver(headless=config.getboolean('BROWSER', 'headless_browser'), stealth_mode=stealth_mode),
        anticaptcha_manual_install=stealth_mode
    )
    logger.info("Browser initialized")

    agents = [
        CasualAgent(
            name=config["MAIN"]["agent_name"],
            prompt_path=f"prompts/{personality_folder}/casual_agent.txt",
            provider=provider, verbose=False
        ),
        CoderAgent(
            name="coder",
            prompt_path=f"prompts/{personality_folder}/coder_agent.txt",
            provider=provider, verbose=False
        ),
        FileAgent(
            name="File Agent",
            prompt_path=f"prompts/{personality_folder}/file_agent.txt",
            provider=provider, verbose=False
        ),
        BrowserAgent(
            name="Browser",
            prompt_path=f"prompts/{personality_folder}/browser_agent.txt",
            provider=provider, verbose=False, browser=browser
        ),
        PlannerAgent(
            name="Planner",
            prompt_path=f"prompts/{personality_folder}/planner_agent.txt",
            provider=provider, verbose=False, browser=browser
        )
    ]
    logger.info("Agents initialized")

    # Create a simple Interaction class with a basic router
    class SimpleInteraction:
        def __init__(self, agents):
            self.is_active = True
            self.current_agent = agents[0]  # Use the first agent by default
            self.last_query = None
            self.last_answer = None
            self.agents = agents
            self.ai_name = "Friday"
            self.is_generating = False
            self.last_success = True

        def select_agent(self, query):
            # Simple keyword-based routing
            query = query.lower()

            # Coding related keywords
            if any(keyword in query for keyword in ['code', 'program', 'function', 'class', 'bug', 'debug', 'fix', 'error', 'python', 'javascript', 'java', 'c++', 'programming', 'game', 'snake', 'build']):
                for agent in self.agents:
                    if agent.type == "coder_agent":
                        pretty_print(f"Selected agent: {agent.agent_name} (roles: {agent.role})", color="warning")
                        return agent

            # File related keywords
            if any(keyword in query for keyword in ['file', 'folder', 'directory', 'path', 'save', 'open', 'read', 'write', 'find file']):
                for agent in self.agents:
                    if agent.type == "file_agent":
                        pretty_print(f"Selected agent: {agent.agent_name} (roles: {agent.role})", color="warning")
                        return agent

            # Browser related keywords
            if any(keyword in query for keyword in ['browse', 'web', 'search', 'internet', 'website', 'url', 'link', 'page', 'browser']):
                for agent in self.agents:
                    if agent.type == "browser_agent":
                        pretty_print(f"Selected agent: {agent.agent_name} (roles: {agent.role})", color="warning")
                        return agent

            # Complex task keywords
            if any(keyword in query for keyword in ['plan', 'complex', 'multi-step', 'project', 'organize', 'strategy']):
                for agent in self.agents:
                    if agent.type == "planner_agent":
                        pretty_print(f"Selected agent: {agent.agent_name} (roles: {agent.role})", color="warning")
                        return agent

            # Default to casual agent
            for agent in self.agents:
                if agent.type == "casual_agent":
                    pretty_print(f"Selected agent: {agent.agent_name} (roles: {agent.role})", color="warning")
                    return agent

            # If no casual agent, use the first agent
            pretty_print(f"Selected agent: {self.agents[0].agent_name} (roles: {self.agents[0].role})", color="warning")
            return self.agents[0]

        async def process(self, query):
            self.last_query = query
            self.is_generating = True

            # Select the appropriate agent based on the query
            self.current_agent = self.select_agent(query)

            self.last_answer, _ = await self.current_agent.process(query, None)
            self.is_generating = False
            return self.last_answer

        def save_session(self):
            pass

    # Use SimpleInteraction instead of the regular Interaction
    interaction = SimpleInteraction(agents)
    logger.info("Simple Interaction with basic router initialized")
    return interaction

interaction = initialize_system()
is_generating = False
query_resp_history = []

@api.get("/screenshot")
async def get_screenshot():
    logger.info("Screenshot endpoint called")
    screenshot_path = ".screenshots/updated_screen.png"
    if os.path.exists(screenshot_path):
        return FileResponse(screenshot_path)
    logger.error("No screenshot available")
    return JSONResponse(
        status_code=404,
        content={"error": "No screenshot available"}
    )

@api.get("/health")
async def health_check():
    logger.info("Health check endpoint called")
    return {"status": "healthy", "version": "0.1.0"}

@api.get("/is_active")
async def is_active():
    logger.info("Is active endpoint called")
    return {"is_active": interaction.is_active}

@api.get("/latest_answer")
async def get_latest_answer():
    global query_resp_history
    if interaction.current_agent is None:
        return JSONResponse(status_code=404, content={"error": "No agent available"})
    if interaction.current_agent.last_answer not in [q["answer"] for q in query_resp_history]:
        # Get blocks from the agent and convert to dictionary
        blocks_result = interaction.current_agent.get_blocks_result()
        blocks_dict = {}

        # Debug log
        logger.info(f"Number of blocks: {len(blocks_result)}")

        # Convert each block to a dictionary
        for i, block in enumerate(blocks_result):
            try:
                block_dict = block.jsonify()
                blocks_dict[str(i)] = block_dict
                logger.info(f"Block {i}: {block_dict}")
            except Exception as e:
                logger.error(f"Error converting block {i} to dictionary: {str(e)}")

        query_resp = {
            "done": "false",
            "answer": interaction.current_agent.last_answer,
            "agent_name": interaction.current_agent.agent_name if interaction.current_agent else "None",
            "success": interaction.current_agent.success,
            "blocks": blocks_dict,
            "status": interaction.current_agent.get_status_message if interaction.current_agent else "No status available",
            "timestamp": str(time.time())
        }
        query_resp_history.append(query_resp)
        return JSONResponse(status_code=200, content=query_resp)
    if query_resp_history:
        return JSONResponse(status_code=200, content=query_resp_history[-1])
    return JSONResponse(status_code=404, content={"error": "No answer available"})

@api.post("/clear_chat")
async def clear_chat():
    global query_resp_history
    logger.info("Clearing chat history")

    # Clear the query response history
    query_resp_history = []

    # Reset the agent's last answer
    if interaction.current_agent:
        interaction.current_agent.last_answer = None
        interaction.last_answer = None

    return JSONResponse(
        status_code=200,
        content={"status": "success", "message": "Chat history cleared"}
    )

async def think_wrapper(interaction, query, tts_enabled=None):
    try:
        logger.info("Agents request is being processed")
        answer = await interaction.process(query)
        if not answer:
            interaction.last_answer = "Error: No answer from agent"
            interaction.last_success = False
            return False
        else:
            interaction.last_success = True
            return True
    except Exception as e:
        logger.error(f"Error in think_wrapper: {str(e)}")
        interaction.last_answer = f"Error: {str(e)}"
        interaction.last_success = False
        raise e

@api.post("/query", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    global is_generating, query_resp_history
    logger.info(f"Processing query: {request.query}")
    query_resp = QueryResponse(
        done="false",
        answer="",
        agent_name="Friday",
        success="false",
        blocks={},
        status="Ready",
        timestamp=str(time.time())
    )
    if is_generating:
        logger.warning("Another query is being processed, please wait.")
        return JSONResponse(status_code=429, content=query_resp.jsonify())

    try:
        is_generating = True
        success = await think_wrapper(interaction, request.query, request.tts_enabled)
        is_generating = False

        if not success:
            query_resp.answer = interaction.last_answer
            return JSONResponse(status_code=400, content=query_resp.jsonify())

        if interaction.current_agent:
            # Get blocks from the agent and convert to dictionary
            blocks_result = interaction.current_agent.get_blocks_result()
            blocks_json = {}

            # Debug log
            logger.info(f"Number of blocks in query response: {len(blocks_result)}")

            # Convert each block to a dictionary
            for i, block in enumerate(blocks_result):
                try:
                    block_dict = block.jsonify()
                    blocks_json[str(i)] = block_dict
                    logger.info(f"Query block {i}: {block_dict}")
                except Exception as e:
                    logger.error(f"Error converting query block {i} to dictionary: {str(e)}")
        else:
            logger.error("No current agent found")
            blocks_json = {}
            query_resp.answer = "Error: No current agent"
            return JSONResponse(status_code=400, content=query_resp.jsonify())

        logger.info(f"Answer: {interaction.last_answer}")
        logger.info(f"Blocks: {blocks_json}")
        query_resp.done = "true"
        query_resp.answer = interaction.last_answer
        query_resp.agent_name = interaction.current_agent.agent_name
        query_resp.success = str(interaction.last_success)
        query_resp.blocks = blocks_json

        # Store the raw dictionary representation
        query_resp_dict = {
            "done": query_resp.done,
            "answer": query_resp.answer,
            "agent_name": query_resp.agent_name,
            "success": query_resp.success,
            "blocks": query_resp.blocks,
            "status": query_resp.status,
            "timestamp": query_resp.timestamp
        }
        query_resp_history.append(query_resp_dict)

        logger.info("Query processed successfully")
        return JSONResponse(status_code=200, content=query_resp.jsonify())
    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        sys.exit(1)
    finally:
        logger.info("Processing finished")
        if config.getboolean('MAIN', 'save_session'):
            interaction.save_session()

if __name__ == "__main__":
    uvicorn.run(api, host="0.0.0.0", port=8000)