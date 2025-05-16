import os
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session
import uuid # For generating unique thread IDs
from pathlib import Path # Added for explicit .env path

# Explicitly load .env from the script's directory or project root
# This assumes app.py is in the project root directory 'magnus'
# If app.py is deeper, adjust Path('.') accordingly or use an absolute path approach if necessary.
env_path = Path(__file__).resolve().parent / '.env'
if env_path.exists():
    load_dotenv(dotenv_path=env_path, override=True)
    print(f"Loaded .env from {env_path}") # Debug print
else:
    print(f".env file not found at {env_path}, attempting default load_dotenv()") # Debug print
    load_dotenv(override=True)

# Import the chat logic
from chat import invoke_chat_graph, API_KEY as CHAT_API_KEY, app_graph # Import app_graph
from langchain_core.messages import HumanMessage, AIMessage # For message type checking

# Load environment variables from .env file
load_dotenv()

# API_KEY is primarily used by chat.py now, but app.py can check it for initial health.
API_KEY = os.getenv("GEMINI_API_KEY") 

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management

# --- Helper for chat icons ---
CHAT_ICONS = ['📄', '💡', '⚙️', '💬', '🧠', '🚀', '✨']
NEW_CHAT_PLACEHOLDER_ICON = '📝' # Placeholder for new, un-messaged chats

def get_next_icon(current_icon_index):
    return CHAT_ICONS[current_icon_index % len(CHAT_ICONS)]

# --- Flask Routes ---

@app.route('/')
def index():
    session.setdefault('icon_index', -1) # Initialize if not present

    if 'chats' not in session or not session['chats']:
        new_thread_id = str(uuid.uuid4())
        # First chat also starts as a "New Conversation" with placeholder icon
        session['chats'] = [{'thread_id': new_thread_id, 'title': 'New Conversation', 'icon': NEW_CHAT_PLACEHOLDER_ICON}]
        session['current_thread_id'] = new_thread_id
        # icon_index remains -1 until the first message materializes this chat
    
    # Ensure current_thread_id is valid and points to an existing chat
    # If current_thread_id is stale or missing, set to the first chat's ID
    current_thread_id = session.get('current_thread_id')
    chat_thread_ids = [chat['thread_id'] for chat in session.get('chats', [])]
    if not current_thread_id or current_thread_id not in chat_thread_ids:
        if session.get('chats'):
            session['current_thread_id'] = session['chats'][0]['thread_id']
        else: # Should not happen if logic above is correct, but as a fallback
            new_thread_id = str(uuid.uuid4())
            session['chats'] = [{'thread_id': new_thread_id, 'title': 'New Conversation', 'icon': NEW_CHAT_PLACEHOLDER_ICON}]
            session['current_thread_id'] = new_thread_id
            # icon_index remains -1

    # Ensure the active chat is at the top of the list for UI consistency if needed,
    # or rely on JS to always find and mark active. For now, let's assume JS handles highlighting.
    # The order in session['chats'] will represent the order in UI (newest/active first).

    return render_template('index.html', 
                           initial_chats=session.get('chats', []), 
                           initial_active_thread_id=session.get('current_thread_id'))

@app.route('/new_chat', methods=['POST'])
def new_chat():
    # Don't increment icon_index here, only when a chat gets its first message
    new_thread_id = str(uuid.uuid4())
    new_chat_item = {'thread_id': new_thread_id, 'title': 'New Conversation', 'icon': NEW_CHAT_PLACEHOLDER_ICON}
    
    if 'chats' not in session:
        session['chats'] = []
    session['chats'].insert(0, new_chat_item) # Add new chat to the beginning
    session['current_thread_id'] = new_thread_id
    
    app.logger.info(f"New chat created: {new_thread_id}. Current chats: {len(session['chats'])}")
    
    # --- Start Enhanced Debug Logging ---
    data_to_jsonify = {'chats': session['chats'], 'active_thread_id': new_thread_id}
    app.logger.info(f"Data being passed to jsonify in /new_chat: {data_to_jsonify}")
    try:
        # Test if jsonify itself would raise an error with this data (it usually doesn't directly, but good to be thorough)
        # This is more for understanding the data structure.
        from flask import json
        json.dumps(data_to_jsonify) # This will raise an error if data_to_jsonify is not serializable
        app.logger.info("Data for /new_chat successfully serialized by json.dumps for logging.")
    except Exception as e:
        app.logger.error(f"Error trying to json.dumps data for /new_chat for logging: {e}", exc_info=True)
    # --- End Enhanced Debug Logging ---
        
    return jsonify(data_to_jsonify)

@app.route('/switch_chat', methods=['POST'])
def switch_chat():
    data = request.get_json()
    target_thread_id = data.get('thread_id')

    if not target_thread_id:
        return jsonify({'error': 'Thread ID missing'}), 400

    session['current_thread_id'] = target_thread_id

    # Reorder chats to bring the target_thread_id to the front
    chats = session.get('chats', [])
    chat_to_move = None
    for i, chat_item in enumerate(chats):
        if chat_item['thread_id'] == target_thread_id:
            chat_to_move = chats.pop(i)
            break
    if chat_to_move:
        chats.insert(0, chat_to_move)
    session['chats'] = chats

    history_messages = []
    try:
        config = {"configurable": {"thread_id": target_thread_id}}
        graph_state = app_graph.get_state(config)
        if graph_state and graph_state.values.get('messages'):
            for msg in graph_state.values['messages']:
                msg_type = 'human' if isinstance(msg, HumanMessage) else 'ai'
                history_messages.append({'type': msg_type, 'content': msg.content})
    except Exception as e:
        app.logger.error(f"Error retrieving state for thread {target_thread_id}: {e}")
        # Not returning error to client here, just empty messages if state fails

    return jsonify({
        'messages': history_messages, 
        'chats': session['chats'], # Send updated order
        'active_thread_id': target_thread_id
    })


@app.route('/chat', methods=['POST'])
def chat_route(): # Renamed to avoid conflict with chat module
    user_message_text = request.json.get('message', '')
    
    if not CHAT_API_KEY:
        app.logger.error('API key not found or model not initialized in chat.py.')
        return jsonify({'error': 'AI service is not configured. Please check server logs.'}), 500
    
    thread_id = session.get('current_thread_id')
    if not thread_id:
        # This case should ideally be handled by '/' creating a default chat
        app.logger.warning("No current_thread_id in session for /chat. Creating a new one.")
        # For safety, redirect or create a new chat session, though this indicates a flow issue.
        # For now, let's assume '/' or '/new_chat' always sets it.
        return jsonify({'error': 'No active chat session. Please start a new chat.'}), 400

    response_data = {}
    try:
        ai_response_content = invoke_chat_graph(user_message_text, thread_id)
        
        if "Error:" in ai_response_content or "Sorry, I encountered an error" in ai_response_content:
            app.logger.warning(f"Chat logic returned an error message: {ai_response_content}")
            return jsonify({'error': ai_response_content})
        
        response_data['response'] = ai_response_content

        # Update chat title and icon if it's "New Conversation"
        current_chats = session.get('chats', [])
        title_updated = False # Also implies icon update now
        for chat_item in current_chats:
            if chat_item['thread_id'] == thread_id and chat_item['title'] == 'New Conversation':
                if user_message_text: # Ensure there's a message to derive title from
                    words = user_message_text.split(' ')
                    chat_item['title'] = ' '.join(words[:3])
                    if not chat_item['title']: # Handle empty message or very short
                        chat_item['title'] = "Chat"
                    
                    # Update icon from placeholder to a cycled one
                    session['icon_index'] = session.get('icon_index', -1) + 1
                    chat_item['icon'] = get_next_icon(session['icon_index'])
                    
                    title_updated = True
                    app.logger.info(f"Chat materialized: {thread_id} to title '{chat_item['title']}' with icon '{chat_item['icon']}'")
                break
        
        if title_updated:
            session['chats'] = current_chats # Save updated list back to session
            response_data['chats'] = session['chats']
            response_data['active_thread_id'] = thread_id
        
        return jsonify(response_data)
            
    except Exception as e:
        app.logger.error(f"Error in /chat route or calling chat logic: {e}", exc_info=True)
        return jsonify({'error': f'An unexpected server error occurred: {str(e)}'}), 500

if __name__ == '__main__':
    # Configure basic logging for Flask app if not already configured elsewhere
    if not app.debug: # Example: Only configure if not in debug mode, or adjust as needed
        import logging
        logging.basicConfig(level=logging.INFO)

    # Change the port from 5000 to 5001 to avoid conflicts with AirPlay Receiver
    app.run(debug=True, port=5001)