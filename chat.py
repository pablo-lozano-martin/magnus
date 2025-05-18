import os
import google.generativeai as genai
import ollama # Import ollama
from typing import TypedDict, Annotated
import operator
import logging

from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage

# Configure logging for this module
logger = logging.getLogger(__name__)

# --- Global LLM Provider State ---
ACTIVE_PROVIDER = "gemini"  # 'gemini' or 'ollama'
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
OLLAMA_MODEL_NAME = None # e.g., "llama2:latest"

gemini_model = None
ollama_client = None

def initialize_llm_providers():
    global gemini_model, ollama_client, GEMINI_API_KEY, GEMINI_MODEL_NAME
    
    # Initialize Gemini
    if GEMINI_API_KEY:
        try:
            genai.configure(api_key=GEMINI_API_KEY)
            gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
            logger.info(f"Initialized Gemini model: {GEMINI_MODEL_NAME}")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini model: {e}")
            gemini_model = None
    else:
        logger.warning("GEMINI_API_KEY not found. Gemini functionality will be impaired.")
        gemini_model = None

    # Initialize Ollama client
    try:
        ollama_client = ollama.Client() # Uses default host resolution
        logger.info("Attempting to list models with Ollama client at startup...")
        models_info = ollama_client.list()
        logger.info(f"Ollama client initialized. Models found at startup: {models_info}") # Log this
    except Exception as e:
        logger.error(f"Failed to initialize Ollama client or list models at startup: {e}. Ensure Ollama is running.", exc_info=True)
        ollama_client = None

def set_active_llm_provider(provider: str, api_key: str = None, model_name: str = None):
    global ACTIVE_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL_NAME, OLLAMA_MODEL_NAME
    global gemini_model # Allow modification of the global gemini_model

    logger.info(f"Attempting to set active LLM provider to: {provider} with model: {model_name}")
    ACTIVE_PROVIDER = provider

    if provider == "gemini":
        if api_key:
            GEMINI_API_KEY = api_key
            os.environ["GEMINI_API_KEY"] = api_key # Update env var for current process
        if model_name:
            GEMINI_MODEL_NAME = model_name
            os.environ["GEMINI_MODEL"] = model_name # Update env var for current process
        
        if GEMINI_API_KEY and GEMINI_MODEL_NAME:
            try:
                genai.configure(api_key=GEMINI_API_KEY)
                gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
                logger.info(f"Gemini provider reinitialized. Active model: {GEMINI_MODEL_NAME}")
                return True
            except Exception as e:
                logger.error(f"Failed to reinitialize Gemini model {GEMINI_MODEL_NAME}: {e}")
                gemini_model = None
                return False
        else:
            logger.error("Cannot set Gemini provider: API key or model name missing.")
            return False
            
    elif provider == "ollama":
        if model_name:
            OLLAMA_MODEL_NAME = model_name
            # Test if the model exists with Ollama client
            if ollama_client:
                try:
                    ollama_client.show(model_name) # Throws error if model doesn't exist
                    logger.info(f"Ollama provider set. Active model: {OLLAMA_MODEL_NAME}")
                    return True
                except Exception as e:
                    logger.error(f"Failed to set Ollama model {OLLAMA_MODEL_NAME}. Model might not exist or Ollama error: {e}")
                    OLLAMA_MODEL_NAME = None # Reset if invalid
                    return False
            else:
                logger.error("Ollama client not initialized. Cannot set Ollama model.")
                return False
        else:
            logger.error("Cannot set Ollama provider: model name missing.")
            return False
    else:
        logger.error(f"Unknown LLM provider: {provider}")
        return False

# Initialize providers on module load
initialize_llm_providers()

# 1. Define Graph State
class GraphState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]

# --- Internal Node Functions ---
def _call_gemini_node_internal(state: GraphState):
    if not gemini_model:
        logger.error("Gemini model not initialized. Cannot call API.")
        return {"messages": [AIMessage(content="Error: Gemini AI model not available.")]}

    full_history_langchain_messages = state['messages']
    gemini_history_for_chat_start = []
    if len(full_history_langchain_messages) > 1:
        for msg in full_history_langchain_messages[:-1]:
            role = "user" if isinstance(msg, HumanMessage) else "model"
            if isinstance(msg.content, str):
                gemini_history_for_chat_start.append({'role': role, 'parts': [msg.content]})
            else:
                logger.warning(f"Message content is not a string, skipping for Gemini history: {msg}")

    current_user_prompt_text = ""
    if full_history_langchain_messages and isinstance(full_history_langchain_messages[-1], HumanMessage) and isinstance(full_history_langchain_messages[-1].content, str):
        current_user_prompt_text = full_history_langchain_messages[-1].content
    else:
        logger.error(f"Invalid input to Gemini node. Last message not a HumanMessage or content not string. State: {state}")
        return {"messages": [AIMessage(content="Error: Invalid user input format for current prompt.")]}

    try:
        chat_session = gemini_model.start_chat(history=gemini_history_for_chat_start)
        response = chat_session.send_message(current_user_prompt_text)
        ai_response_text = response.text
    except Exception as e:
        logger.error(f"Gemini API call failed: {e}", exc_info=True)
        ai_response_text = "Sorry, I encountered an error while processing your request with Gemini."
    return {"messages": [AIMessage(content=ai_response_text)]}

def _call_ollama_node_internal(state: GraphState):
    if not ollama_client:
        logger.error("Ollama client not initialized.")
        return {"messages": [AIMessage(content="Error: Ollama client not available.")]}
    if not OLLAMA_MODEL_NAME:
        logger.error("Ollama model name not set.")
        return {"messages": [AIMessage(content="Error: Ollama model not selected.")]}

    langchain_messages = state['messages']
    # Convert Langchain messages to Ollama's expected format
    ollama_messages = []
    for msg in langchain_messages:
        role = "user" if isinstance(msg, HumanMessage) else "assistant"
        if isinstance(msg.content, str):
            ollama_messages.append({'role': role, 'content': msg.content})
        else:
            logger.warning(f"Skipping message with non-string content for Ollama: {msg}")
    
    if not ollama_messages:
         logger.error("No valid messages to send to Ollama.")
         return {"messages": [AIMessage(content="Error: No message to send.")]}

    try:
        response = ollama_client.chat(
            model=OLLAMA_MODEL_NAME,
            messages=ollama_messages
        )
        ai_response_text = response['message']['content']
    except Exception as e:
        logger.error(f"Ollama API call failed for model {OLLAMA_MODEL_NAME}: {e}", exc_info=True)
        ai_response_text = f"Sorry, I encountered an error while processing your request with Ollama model {OLLAMA_MODEL_NAME}."
    return {"messages": [AIMessage(content=ai_response_text)]}

# 2. Node to call the active LLM
def call_llm_node(state: GraphState):
    logger.debug(f"Calling LLM node with active provider: {ACTIVE_PROVIDER}")
    if ACTIVE_PROVIDER == "gemini":
        return _call_gemini_node_internal(state)
    elif ACTIVE_PROVIDER == "ollama":
        return _call_ollama_node_internal(state)
    else:
        logger.error(f"Unknown active provider: {ACTIVE_PROVIDER}")
        return {"messages": [AIMessage(content="Error: AI provider not configured correctly.")]}

# 3. Create and compile graph
workflow = StateGraph(GraphState)
workflow.add_node("llm", call_llm_node) # Use the dispatcher node
workflow.set_entry_point("llm")
workflow.add_edge("llm", END)

app_graph = workflow.compile()

def invoke_chat_graph(full_langchain_history: list[BaseMessage]) -> str:
    global ACTIVE_PROVIDER, gemini_model, ollama_client, OLLAMA_MODEL_NAME

    if ACTIVE_PROVIDER == "gemini" and (not GEMINI_API_KEY or not gemini_model):
        logger.error("Cannot invoke chat graph with Gemini: API_KEY or model not configured.")
        return "Error: Gemini AI service is not configured. Please check API key and model settings."
    elif ACTIVE_PROVIDER == "ollama" and (not ollama_client or not OLLAMA_MODEL_NAME):
        logger.error(f"Cannot invoke chat graph with Ollama: Client not init or model not set (Current: {OLLAMA_MODEL_NAME}).")
        return "Error: Ollama AI service is not configured. Please select a model and ensure Ollama is running."

    inputs = {"messages": full_langchain_history}
    
    try:
        final_graph_state = app_graph.invoke(inputs)
        # ... (rest of the error handling and response extraction remains similar) ...
        if final_graph_state and final_graph_state.get('messages'):
            ai_response_message = final_graph_state['messages'][-1]
            if isinstance(ai_response_message, AIMessage) and isinstance(ai_response_message.content, str):
                return ai_response_message.content
            else:
                logger.error(f"Graph returned unexpected message type or content. Last message: {ai_response_message}")
                return "Error: Received an unexpected response format from AI."
        else:
            logger.error(f"Graph did not return expected messages. Final state: {final_graph_state}")
            return "Error: No response from AI after graph execution."
            
    except Exception as e:
        logger.error(f"Error during LangGraph invocation with {ACTIVE_PROVIDER}: {e}", exc_info=True)
        return f"An error occurred while communicating with the AI ({ACTIVE_PROVIDER}): {str(e)}"

# Renamed from reinitialize_model for clarity, though set_active_llm_provider is more descriptive
# This function is kept for compatibility if app.py was calling reinitialize_model directly for Gemini.
# It's better to use set_active_llm_provider from app.py.
def reinitialize_model(api_key, model_name):
    return set_active_llm_provider(provider="gemini", api_key=api_key, model_name=model_name)

