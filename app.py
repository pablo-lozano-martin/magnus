import os
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session
import uuid # For generating unique thread IDs
from pathlib import Path # Added for explicit .env path
import sqlite3
import datetime
import ollama # Added for Ollama integration

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
from chat import invoke_chat_graph, set_active_llm_provider # Import new function
from langchain_core.messages import HumanMessage, AIMessage # For message type checking

# Load environment variables from .env file
load_dotenv()

# API_KEY is primarily used by chat.py now, but app.py can check it for initial health.
# GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") # chat.py handles this

# Define a constant for the client-side placeholder ID, if needed for backend checks
# However, client will send `null` for thread_id for new chats.
# TEMP_NEW_CHAT_ID_MARKER = "temp-new-chat-placeholder" # Or rely on thread_id being None

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management

DATABASE = Path(__file__).resolve().parent / 'chat_history.db'

# --- Database Helper Functions ---
def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    with open(Path(__file__).resolve().parent / 'schema.sql', 'r') as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()
    app.logger.info("Database initialized.")

def add_conversation_to_db(thread_id, title, icon):
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO conversations (id, title, icon, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?)", # Added is_pinned
            (thread_id, title, icon, datetime.datetime.now(datetime.timezone.utc), 0) # Default is_pinned to 0
        )
        conn.commit()
    except sqlite3.IntegrityError:
        app.logger.warning(f"Conversation with ID {thread_id} already exists or other integrity error.")
    finally:
        conn.close()

def update_conversation_in_db(thread_id, title, icon):
    conn = get_db_connection()
    conn.execute(
        "UPDATE conversations SET title = ?, icon = ?, updated_at = ? WHERE id = ?",
        (title, icon, datetime.datetime.now(datetime.timezone.utc), thread_id)
    )
    conn.commit()
    conn.close()

def add_message_to_db(conversation_id, sender_type, content, sequence):
    conn = get_db_connection()
    message_id = str(uuid.uuid4()) # Generate UUID for the message
    conn.execute(
        "INSERT INTO messages (id, conversation_id, sender_type, content, sequence) VALUES (?, ?, ?, ?, ?)", # Added id column
        (message_id, conversation_id, sender_type, content, sequence) # Pass message_id
    )
    conn.commit()
    conn.close()

def get_messages_from_db(conversation_id):
    conn = get_db_connection()
    messages_cursor = conn.execute(
        "SELECT sender_type, content FROM messages WHERE conversation_id = ? ORDER BY sequence ASC",
        (conversation_id,)
    )
    messages = [{'type': row['sender_type'], 'content': row['content']} for row in messages_cursor.fetchall()]
    conn.close()
    return messages

def get_all_conversations_from_db():
    conn = get_db_connection()
    # Order by is_pinned (descending, so pinned are first), then by updated_at (descending)
    conv_cursor = conn.execute("SELECT id, title, icon, is_pinned FROM conversations ORDER BY is_pinned DESC, updated_at DESC")
    conversations = [{'thread_id': row['id'], 'title': row['title'], 'icon': row['icon'], 'is_pinned': bool(row['is_pinned'])} for row in conv_cursor.fetchall()]
    conn.close()
    return conversations

def get_last_message_sequence(conversation_id):
    conn = get_db_connection()
    cursor = conn.execute("SELECT MAX(sequence) as last_sequence FROM messages WHERE conversation_id = ?", (conversation_id,))
    result = cursor.fetchone()
    conn.close()
    return result['last_sequence'] if result and result['last_sequence'] is not None else -1

def update_conversation_updated_at(thread_id):
    conn = get_db_connection()
    conn.execute(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
        (datetime.datetime.now(datetime.timezone.utc), thread_id)
    )
    conn.commit()
    conn.close()

def delete_conversation_from_db(thread_id):
    conn = get_db_connection()
    try:
        # Delete messages associated with the conversation
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (thread_id,))
        # Delete the conversation itself
        conn.execute("DELETE FROM conversations WHERE id = ?", (thread_id,))
        conn.commit()
        app.logger.info(f"Conversation {thread_id} and its messages deleted from DB.")
    except Exception as e:
        app.logger.error(f"Error deleting conversation {thread_id}: {e}")
    finally:
        conn.close()

def rename_conversation_in_db(thread_id, new_title):
    conn = get_db_connection()
    try:
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (new_title, datetime.datetime.now(datetime.timezone.utc), thread_id)
        )
        conn.commit()
        app.logger.info(f"Conversation {thread_id} renamed to '{new_title}'.")
    except Exception as e:
        app.logger.error(f"Error renaming conversation {thread_id} to '{new_title}': {e}")
    finally:
        conn.close()

def toggle_pin_conversation_in_db(thread_id):
    conn = get_db_connection()
    try:
        cursor = conn.execute("SELECT is_pinned FROM conversations WHERE id = ?", (thread_id,))
        row = cursor.fetchone()
        if (row is None):
            app.logger.error(f"Conversation {thread_id} not found for pinning.")
            return False

        current_is_pinned = row['is_pinned']
        new_is_pinned = 1 if current_is_pinned == 0 else 0 # Toggle the value

        conn.execute(
            "UPDATE conversations SET is_pinned = ? WHERE id = ?", # Do not update updated_at here, pinning shouldn't change recency for non-pinned items
            (new_is_pinned, thread_id)
        )
        conn.commit()
        app.logger.info(f"Conversation {thread_id} pin status toggled to {new_is_pinned}.")
        return True
    except Exception as e:
        app.logger.error(f"Error toggling pin for conversation {thread_id}: {e}")
        return False
    finally:
        conn.close()


# Initialize DB if it doesn't exist or schema is not applied
if not DATABASE.exists():
    init_db()
else: # Basic check if tables exist, can be more robust
    conn = get_db_connection()
    try:
        conn.execute("SELECT 1 FROM conversations LIMIT 1")
        conn.execute("SELECT 1 FROM messages LIMIT 1")
    except sqlite3.OperationalError:
        app.logger.warning("Database tables not found, re-initializing.")
        init_db() # Re-initialize if tables are missing
    finally:
        conn.close()


# --- Helper for chat icons ---
CHAT_ICONS = ['📄', '💡', '⚙️', '💬', '🧠', '🚀', '✨']
NEW_CHAT_PLACEHOLDER_ICON = '📝' # Placeholder for new, un-messaged chats

def get_next_icon(current_icon_index):
    return CHAT_ICONS[current_icon_index % len(CHAT_ICONS)]

# --- Flask Routes ---

@app.route('/')
def index():
    session.setdefault('icon_index', -1) 
    
    db_conversations = get_all_conversations_from_db()
    session['chats'] = db_conversations

    active_thread_id = None
    if db_conversations:
        current_thread_id_session = session.get('current_thread_id')
        db_thread_ids = [chat['thread_id'] for chat in db_conversations]
        if current_thread_id_session in db_thread_ids:
            active_thread_id = current_thread_id_session
        else:
            active_thread_id = db_conversations[0]['thread_id']
            session['current_thread_id'] = active_thread_id
    else:
        session.pop('current_thread_id', None) 
        active_thread_id = None

    # Get current active model info
    try:
        from chat import ACTIVE_PROVIDER, GEMINI_MODEL_NAME, OLLAMA_MODEL_NAME
        current_provider = ACTIVE_PROVIDER
        current_model = GEMINI_MODEL_NAME if ACTIVE_PROVIDER == 'gemini' else OLLAMA_MODEL_NAME
    except:
        current_provider = 'gemini'
        current_model = 'gemini-1.5-flash'

    return render_template('index.html', 
                           initial_chats=session.get('chats', []), 
                           initial_active_thread_id=active_thread_id,
                           current_provider=current_provider,
                           current_model=current_model)

@app.route('/new_chat', methods=['POST'])
def new_chat():
    session['current_thread_id'] = None
    return jsonify({'chats': get_all_conversations_from_db(), 'active_thread_id': None, 'use_placeholder': True })


@app.route('/switch_chat', methods=['POST'])
def switch_chat():
    data = request.get_json()
    target_thread_id = data.get('thread_id')

    if not target_thread_id:
        return jsonify({'error': 'Thread ID missing'}), 400

    session['current_thread_id'] = target_thread_id
    
    all_db_conversations = get_all_conversations_from_db()
    session['chats'] = all_db_conversations

    history_messages = get_messages_from_db(target_thread_id)

    return jsonify({
        'messages': history_messages, 
        'chats': session['chats'],
        'active_thread_id': target_thread_id
    })


@app.route('/chat', methods=['POST'])
def chat_route(): 
    user_message_text = request.json.get('message', '')
    requested_thread_id = request.json.get('thread_id')

    app.logger.info(f"📝 Received chat request. Message: {user_message_text[:100]}...")
    app.logger.info(f"🔖 Thread ID: {requested_thread_id if requested_thread_id else 'NEW THREAD'}")

    # Consolidate provider management
    active_provider = session.get('active_provider', 'gemini')
    active_model_name = session.get('active_model_name')
    gemini_api_key_for_session = session.get('gemini_api_key', os.getenv("GEMINI_API_KEY"))

    app.logger.info(f"🤖 Using provider: {active_provider}, Model: {active_model_name or 'default'}")

    if active_provider == 'gemini':
        if not gemini_api_key_for_session:
            return jsonify({'error': 'Gemini AI service is not configured (API key missing).'}), 500
        set_active_llm_provider(provider='gemini', api_key=gemini_api_key_for_session, model_name=active_model_name)
    elif active_provider == 'ollama':
        if not active_model_name:
            return jsonify({'error': 'Ollama model not selected.'}), 500
        set_active_llm_provider(provider='ollama', model_name=active_model_name)
    else:
        return jsonify({'error': 'AI provider misconfiguration.'}), 500
    
    is_newly_created = False
    title_updated = False
    
    if requested_thread_id is None:
        is_newly_created = True
        thread_id = str(uuid.uuid4())
        session['current_thread_id'] = thread_id
        app.logger.info(f"🆕 Created new thread with ID: {thread_id}")

        words = user_message_text.split(' ')
        new_title = ' '.join(words[:3]) or "Chat"
        
        session['icon_index'] = session.get('icon_index', -1) + 1
        new_icon = get_next_icon(session['icon_index'])
        
        add_conversation_to_db(thread_id, new_title, new_icon)
    else:
        thread_id = requested_thread_id
        session['current_thread_id'] = thread_id

    response_data = {}
    try:
        # Store user message
        last_sequence = get_last_message_sequence(thread_id)
        user_message_sequence = last_sequence + 1
        add_message_to_db(thread_id, 'human', user_message_text, user_message_sequence)
        app.logger.info(f"💾 Stored user message in DB with sequence: {user_message_sequence}")

        # Get full history for LangGraph
        db_messages_for_graph = get_messages_from_db(thread_id)
        app.logger.info(f"📚 Retrieved message history from DB. Message count: {len(db_messages_for_graph)}")
        
        langchain_history = []
        for msg in db_messages_for_graph:
            if msg['type'] == 'human':
                langchain_history.append(HumanMessage(content=msg['content']))
            else:
                langchain_history.append(AIMessage(content=msg['content']))

        app.logger.info(f"🔄 Invoking chat graph with {len(langchain_history)} messages")
        ai_response_content = invoke_chat_graph(langchain_history)
        app.logger.info(f"📥 Received response from chat graph. Length: {len(ai_response_content)}")
        
        if "Error:" in ai_response_content or "Sorry, I encountered an error" in ai_response_content:
            app.logger.error(f"❌ Error in AI response: {ai_response_content}")
            return jsonify({'error': ai_response_content})
        
        # Handle thinking content
        thinking_content = None
        final_content = ai_response_content
        
        try:
            import json
            if ai_response_content.startswith('{') and 'thinking' in ai_response_content:
                app.logger.info("🧠 Detected JSON response with thinking content")
                parsed_response = json.loads(ai_response_content)
                if isinstance(parsed_response, dict) and parsed_response.get('has_thinking'):
                    thinking_content = parsed_response.get('thinking')
                    final_content = parsed_response.get('content', ai_response_content)
                    app.logger.info(f"🧠 Extracted thinking content. Length: {len(thinking_content)}")
                    app.logger.info(f"💬 Extracted final content. Length: {len(final_content)}")
        except json.JSONDecodeError:
            app.logger.warning("❌ Failed to parse response as JSON despite JSON-like structure")
            pass
        except Exception as e:
            app.logger.warning(f"❌ Error parsing thinking response: {e}")
        
        # Store AI message
        add_message_to_db(thread_id, 'ai', final_content, user_message_sequence + 1)
        app.logger.info(f"💾 Stored AI response in DB with sequence: {user_message_sequence + 1}")
        
        if thinking_content:
            app.logger.info("📦 Preparing response with thinking content")
            response_data['response'] = final_content
            response_data['thinking'] = thinking_content
            response_data['has_thinking'] = True
        else:
            app.logger.info("📦 Preparing standard response (no thinking)")
            response_data['response'] = final_content
        
        if not is_newly_created:
            update_conversation_updated_at(thread_id)

        # Check for title update
        if not is_newly_created:
            active_chat_from_db = next((c for c in get_all_conversations_from_db() if c['thread_id'] == thread_id), None)
            if active_chat_from_db and active_chat_from_db['title'] == 'New Conversation':
                if user_message_text: 
                    words = user_message_text.split(' ')
                    updated_title = ' '.join(words[:3]) or "Chat"
                    
                    session['icon_index'] = session.get('icon_index', -1) + 1
                    updated_icon = get_next_icon(session['icon_index'])
                    
                    update_conversation_in_db(thread_id, updated_title, updated_icon)
                    title_updated = True

        if is_newly_created or title_updated:
            session['chats'] = get_all_conversations_from_db()
            response_data['chats'] = session['chats']
            response_data['active_thread_id'] = thread_id 
            if is_newly_created:
                response_data['newly_created_thread_id'] = thread_id
        
        return jsonify(response_data)
            
    except Exception as e:
        app.logger.error(f"❌ Error in /chat route: {e}", exc_info=True)
        return jsonify({'error': f'An unexpected server error occurred: {str(e)}'}), 500

@app.route('/rename_chat', methods=['POST'])
def rename_chat_route():
    data = request.get_json()
    thread_id = data.get('thread_id')
    new_title = data.get('new_title')

    if not thread_id or not new_title:
        return jsonify({'error': 'Missing thread_id or new_title'}), 400

    rename_conversation_in_db(thread_id, new_title)
    
    updated_chats = get_all_conversations_from_db()
    session['chats'] = updated_chats

    return jsonify({
        'message': 'Chat renamed successfully',
        'chats': updated_chats,
        'active_thread_id': session.get('current_thread_id')
    })

@app.route('/toggle_pin_chat', methods=['POST'])
def toggle_pin_chat_route():
    data = request.get_json()
    thread_id = data.get('thread_id')

    if not thread_id:
        return jsonify({'error': 'Missing thread_id'}), 400

    success = toggle_pin_conversation_in_db(thread_id)
    if not success:
        return jsonify({'error': 'Failed to toggle pin status'}), 500
    
    updated_chats = get_all_conversations_from_db()
    session['chats'] = updated_chats

    return jsonify({
        'message': 'Chat pin status toggled successfully',
        'chats': updated_chats,
        'active_thread_id': session.get('current_thread_id')
    })

@app.route('/delete_chat', methods=['POST'])
def delete_chat_route():
    data = request.get_json()
    thread_id_to_delete = data.get('thread_id')

    if not thread_id_to_delete:
        return jsonify({'error': 'Missing thread_id'}), 400

    delete_conversation_from_db(thread_id_to_delete)

    remaining_chats = get_all_conversations_from_db()
    session['chats'] = remaining_chats

    new_active_thread_id = session.get('current_thread_id')

    if thread_id_to_delete == new_active_thread_id:
        if remaining_chats:
            new_active_thread_id = remaining_chats[0]['thread_id']
        else:
            new_active_thread_id = None
        session['current_thread_id'] = new_active_thread_id
    
    return jsonify({
        'message': 'Chat deleted successfully',
        'chats': remaining_chats,
        'active_thread_id': new_active_thread_id
    })

@app.route('/delete_all_chats', methods=['POST'])
def delete_all_chats_route():
    """Delete all conversations and messages from the database"""
    conn = get_db_connection()
    try:
        # Delete all messages first (due to foreign key constraint)
        conn.execute("DELETE FROM messages")
        # Delete all conversations
        conn.execute("DELETE FROM conversations")
        conn.commit()
        
        # Clear session data
        session.pop('chats', None)
        session.pop('current_thread_id', None)
        session['icon_index'] = -1
        
        app.logger.info("All chat history deleted successfully")
        return jsonify({'message': 'All chat history deleted successfully'})
        
    except Exception as e:
        conn.rollback()
        app.logger.error(f"Error deleting all chats: {e}")
        return jsonify({'error': f'Failed to delete chat history: {str(e)}'}), 500
    finally:
        conn.close()

@app.route('/get_ollama_models', methods=['GET'])
def get_ollama_models_route():
    models_data_raw_response = None
    client_used_desc = "None"

    try:
        client_default = ollama.Client()
        models_data_raw_response = client_default.list()
        client_used_desc = "Default ollama.Client()"
        app.logger.info(f"Raw response object from {client_used_desc}: {models_data_raw_response}")

        if (not models_data_raw_response or not models_data_raw_response.get('models')) and os.getenv('OLLAMA_HOST'):
            ollama_host_env = os.getenv('OLLAMA_HOST')
            app.logger.info(f"{client_used_desc} returned no models. OLLAMA_HOST ('{ollama_host_env}') is set. Retrying with explicit host.")
            client_explicit_env = ollama.Client(host=ollama_host_env)
            models_data_raw_response = client_explicit_env.list()
            client_used_desc = f"ollama.Client(host='{ollama_host_env}') from OLLAMA_HOST"
            app.logger.info(f"Raw response object from {client_used_desc}: {models_data_raw_response}")

        if (not models_data_raw_response or not models_data_raw_response.get('models')):
            hardcoded_host = 'http://localhost:11434'
            if os.getenv('OLLAMA_HOST') != hardcoded_host:
                app.logger.info(f"{client_used_desc} returned no models. Retrying with hardcoded host: {hardcoded_host}.")
                client_hardcoded = ollama.Client(host=hardcoded_host)
                models_data_raw_response = client_hardcoded.list()
                client_used_desc = f"ollama.Client(host='{hardcoded_host}')"
                app.logger.info(f"Raw response object from {client_used_desc}: {models_data_raw_response}")
            else:
                app.logger.info(f"{client_used_desc} returned no models. Hardcoded host '{hardcoded_host}' was already tried via OLLAMA_HOST or default.")
        
        models_list = []
        if models_data_raw_response and 'models' in models_data_raw_response and isinstance(models_data_raw_response['models'], list):
            actual_model_objects_list = models_data_raw_response['models']
            app.logger.info(f"Actual list of model objects from Ollama: {actual_model_objects_list}")
            for model_obj in actual_model_objects_list:
                try:
                    modified_at_str = model_obj.modified_at.isoformat() if hasattr(model_obj, 'modified_at') and model_obj.modified_at else None
                    
                    model_name_attr = getattr(model_obj, 'model', None)
                    if not model_name_attr:
                        app.logger.warning(f"Model object missing 'model' attribute: {model_obj}")
                        continue

                    models_list.append({
                        'name': model_name_attr,
                        'modified_at': modified_at_str,
                        'size': getattr(model_obj, 'size', None)
                    })
                except AttributeError as ae:
                    app.logger.warning(f"Skipping model entry due to AttributeError: {model_obj}. Error: {ae}")
                except Exception as e_inner:
                    app.logger.warning(f"Skipping model entry {getattr(model_obj, 'model', 'Unknown Model')} due to other error: {e_inner}. Object: {model_obj}")

        else:
            app.logger.warning(f"No 'models' key found in Ollama response (using {client_used_desc}) or it's not a list. Full response: {models_data_raw_response}")
            
        app.logger.info(f"Processed models_list to be sent to client: {models_list}")
        return jsonify({'models': models_list})

    except ollama.ResponseError as e:
        app.logger.error(f"Ollama ResponseError while trying to list models with {client_used_desc}: {str(e)}. Status code: {e.status_code}", exc_info=True)
        return jsonify({'error': f'Ollama API error: {str(e)} (Status: {e.status_code})'}), 500
    except ollama.RequestError as e:
        app.logger.error(f"Ollama RequestError (e.g. connection issue) while trying to list models with {client_used_desc}: {str(e)}", exc_info=True)
        return jsonify({'error': f'Could not connect to Ollama: {str(e)}'}), 500
    except Exception as e:
        app.logger.error(f"Generic error connecting to Ollama or listing models with {client_used_desc}: {str(e)}", exc_info=True)
        if isinstance(e, TypeError) and "not JSON serializable" in str(e):
             app.logger.error("JSON serialization error likely due to unhandled Ollama model object structure.")
        return jsonify({'error': f'Could not connect to Ollama or list models: {str(e)}'}), 500


@app.route('/update_model_settings', methods=['POST'])
def update_model_settings():
    data = request.get_json()
    provider = data.get('provider', 'gemini')

    if provider == 'gemini':
        api_key = data.get('api_key')
        model_name = data.get('model_name')
        
        if not api_key:
            return jsonify({'error': 'API key cannot be empty for Gemini'}), 400
            
        gemini_models_list = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
                              'gemini-2.0-flash', 'gemini-2.0-flash-lite',
                              'gemini-2.0-flash-thinking-exp',
                              'gemini-2.5-flash-preview-04-17', 'gemini-2.5-pro-preview-05-06']

        if model_name not in gemini_models_list:
            return jsonify({'error': 'Invalid Gemini model selection'}), 400
        
        success = set_active_llm_provider(provider='gemini', api_key=api_key, model_name=model_name)
        
        if success:
            session['active_provider'] = 'gemini'
            session['active_model_name'] = model_name
            session['gemini_api_key'] = api_key
            app.logger.info(f"Gemini model settings updated and set active: {model_name}")
            return jsonify({'message': f'Gemini model settings updated successfully. Now using {model_name}.'})
        else:
            app.logger.error(f"Failed to set Gemini model {model_name} in chat.py.")
            return jsonify({'error': f'Failed to validate Gemini API key or model: {model_name}. Check server logs.'}), 400
    
    elif provider == 'ollama':
        model_name = data.get('model_name')
        if not model_name:
            return jsonify({'error': 'Ollama model name cannot be empty.'}), 400

        success = set_active_llm_provider(provider='ollama', model_name=model_name)
        if success:
            session['active_provider'] = 'ollama'
            session['active_model_name'] = model_name
            session.pop('gemini_api_key', None) 
            app.logger.info(f"Ollama model set active: {model_name}")
            return jsonify({'message': f'Successfully switched to Ollama model: {model_name}.'})
        else:
            app.logger.error(f"Failed to set Ollama model {model_name} in chat.py. It might not exist or Ollama is down.")
            return jsonify({'error': f'Failed to set Ollama model: {model_name}. Ensure it exists and Ollama is running.'}), 400
    else:
        return jsonify({'error': 'Unknown model provider.'}), 400

@app.route('/get_current_model', methods=['GET'])
def get_current_model():
    """Return the currently active model provider and model name"""
    try:
        from chat import ACTIVE_PROVIDER, GEMINI_MODEL_NAME, OLLAMA_MODEL_NAME
        
        if ACTIVE_PROVIDER == 'gemini':
            return jsonify({
                'provider': 'gemini',
                'model_name': GEMINI_MODEL_NAME or 'gemini-1.5-flash'
            })
        elif ACTIVE_PROVIDER == 'ollama':
            return jsonify({
                'provider': 'ollama', 
                'model_name': OLLAMA_MODEL_NAME or 'Unknown Ollama Model'
            })
        else:
            return jsonify({
                'provider': 'gemini',
                'model_name': 'gemini-1.5-flash'
            })
    except Exception as e:
        app.logger.error(f"Error getting current model info: {e}")
        return jsonify({
            'provider': 'gemini',
            'model_name': 'gemini-1.5-flash'
        })

if __name__ == '__main__':
    if not app.debug: 
        import logging
        logging.basicConfig(level=logging.INFO)
    else:
        app.logger.setLevel(logging.INFO)


    app.run(debug=True, port=5001)