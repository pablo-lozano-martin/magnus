import os
import google.generativeai as genai
from typing import TypedDict, Annotated
import operator
import logging

from langgraph.graph import StateGraph, END # Changed StatefulGraph to StateGraph
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage

# Configure logging for this module
logger = logging.getLogger(__name__)

# Load API key and initialize Gemini model
API_KEY = os.getenv("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    logger.error("GEMINI_API_KEY not found. Chat functionality will be impaired.")
    model = None

# 1. Define Graph State
class GraphState(TypedDict):
    messages: Annotated[list[BaseMessage], operator.add]

# 2. Node to call Gemini
def call_gemini_node(state: GraphState):
    if not model:
        logger.error("Gemini model not initialized. Cannot call API.")
        return {"messages": [AIMessage(content="Error: AI model not available.")]}

    langchain_messages = state['messages']
    
    gemini_history_for_chat_start = []
    if len(langchain_messages) > 1:
        for msg in langchain_messages[:-1]: # All but the last message
            role = "user" if isinstance(msg, HumanMessage) else "model"
            if isinstance(msg.content, str):
                gemini_history_for_chat_start.append({'role': role, 'parts': [msg.content]})

    current_user_prompt_text = ""
    if langchain_messages and isinstance(langchain_messages[-1], HumanMessage) and isinstance(langchain_messages[-1].content, str):
        current_user_prompt_text = langchain_messages[-1].content
    else:
        logger.error(f"Invalid input to call_gemini_node. Last message not a HumanMessage or content not string. State: {state}")
        return {"messages": [AIMessage(content="Error: Invalid user input format.")]}

    try:
        chat_session = model.start_chat(history=gemini_history_for_chat_start)
        response = chat_session.send_message(current_user_prompt_text)
        ai_response_text = response.text
    except Exception as e:
        logger.error(f"Gemini API call failed: {e}", exc_info=True)
        ai_response_text = "Sorry, I encountered an error while processing your request."

    return {"messages": [AIMessage(content=ai_response_text)]}

# 3. Create and compile graph
workflow = StateGraph(GraphState) # Changed StatefulGraph to StateGraph
workflow.add_node("llm", call_gemini_node)
workflow.set_entry_point("llm")
workflow.add_edge("llm", END)

memory = MemorySaver()
app_graph = workflow.compile(checkpointer=memory)

def invoke_chat_graph(user_message_text: str, thread_id: str) -> str:
    """
    Invokes the chat graph with the user's message and thread_id.
    Returns the AI's response content as a string.
    """
    if not API_KEY or not model:
        logger.error("Cannot invoke chat graph: API_KEY or model not configured.")
        return "Error: AI service is not configured."

    inputs = {"messages": [HumanMessage(content=user_message_text)]}
    config = {"configurable": {"thread_id": thread_id}}
    
    try:
        final_graph_state = app_graph.invoke(inputs, config)
        
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
        logger.error(f"Error during LangGraph invocation: {e}", exc_info=True)
        # Propagate a user-friendly error message
        return f"An error occurred while communicating with the AI: {str(e)}"

