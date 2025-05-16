document.addEventListener('DOMContentLoaded', function() {
    const messagesContainer = document.getElementById('messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const emojiElement = document.querySelector('.emoji');
    const newChatButton = document.getElementById('new-chat-button');
    const chatListUL = document.querySelector('.chat-list');

    let currentChats = [];
    let currentActiveThreadId = null;
    
    // Array of AI-themed emojis
    const emojis = [
        '🧠', '🤖', '💡', '✨', '🔮', '👾', '🚀', '🌟', '🔭', '🦄', 
        '🔍', '💬', '💭', '🎯', '⚡️', '🌐', '🧩', '🧪', '🍀', '☀️'
    ];
    
    // Function to get a random emoji different from the current one
    function getRandomEmoji(currentEmoji) {
        let newEmoji;
        do {
            newEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        } while (newEmoji === currentEmoji);
        return newEmoji;
    }
    
    // Add click event to the emoji
    document.querySelector('.logo-icon').addEventListener('click', function() {
        const currentEmoji = emojiElement.textContent;
        const newEmoji = getRandomEmoji(currentEmoji);
        
        // Add animation classes
        emojiElement.classList.add('emoji-rotate-out');
        
        // After the first animation completes, change the emoji and animate back in
        setTimeout(() => {
            emojiElement.textContent = newEmoji;
            emojiElement.classList.remove('emoji-rotate-out');
            emojiElement.classList.add('emoji-rotate-in');
            
            // Remove the animation class after it's complete
            setTimeout(() => {
                emojiElement.classList.remove('emoji-rotate-in');
            }, 150);
        }, 150);
    });
    
    // Function to get current time in HH:MM format
    function getCurrentTime() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    
    // Get today's date for timestamp
    function getFormattedDate() {
        const options = { month: 'long', day: 'numeric', year: 'numeric' };
        return new Date().toLocaleDateString('en-US', options);
    }
    
    // Update timestamp
    const timestampDiv = document.querySelector('.message-timestamp');
    timestampDiv.textContent = getFormattedDate();

    // Function to clear all messages from the UI, keeping the timestamp
    function clearMessagesUI() {
        // Keep the timestamp, remove all other children (messages)
        while (messagesContainer.children.length > 1) {
            if (messagesContainer.lastChild.classList.contains('message') || messagesContainer.lastChild.id === 'typing-indicator') {
                messagesContainer.removeChild(messagesContainer.lastChild);
            } else {
                // Fallback if something unexpected is there, to avoid infinite loop
                break; 
            }
        }
    }

    // Function to display the initial AI greeting
    function displayInitialAIMessage() {
        const initialMessageText = "Hi there! I'm your Gemini Assistant. How can I help you today?";
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message received';
        
        messageDiv.innerHTML = `
            <div class="message-bubble">
                <div class="message-text">${initialMessageText}</div>
            </div>
            <div class="message-time">${getCurrentTime()}</div>
        `;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Function to render the sidebar
    function renderSidebar(chats, activeThreadId) {
        chatListUL.innerHTML = ''; // Clear existing items
        currentChats = chats; // Update global state
        currentActiveThreadId = activeThreadId;

        if (!currentChats || currentChats.length === 0) {
            // This case should ideally be handled by the backend ensuring at least one chat exists
            console.warn("No chats to render in sidebar.");
            return;
        }

        currentChats.forEach(chat => {
            const listItem = document.createElement('li');
            listItem.className = 'chat-list-item';
            listItem.dataset.threadId = chat.thread_id;

            if (chat.thread_id === activeThreadId) {
                listItem.classList.add('active');
            }

            // For now, time is static or not shown. Could be enhanced.
            // const timeDisplay = chat.thread_id === activeThreadId ? 'Now' : ''; 
            const timeDisplay = chat.time || (chat.thread_id === activeThreadId ? 'Active' : '');


            listItem.innerHTML = `
                <span class="chat-item-icon">${chat.icon || '📄'}</span>
                <span class="chat-item-text">${chat.title}</span>
                <span class="chat-item-time">${timeDisplay}</span>
            `;
            listItem.addEventListener('click', () => handleSwitchChat(chat.thread_id));
            chatListUL.appendChild(listItem);
        });
    }

    // Function to handle switching chats
    async function handleSwitchChat(threadId) {
        if (threadId === currentActiveThreadId && messagesContainer.children.length > 1) { // Avoid reload if already active and has messages
            // If it's the same thread and messages are already there, just ensure it's visually active
            document.querySelectorAll('.chat-list-item').forEach(item => item.classList.remove('active'));
            const activeLi = chatListUL.querySelector(`.chat-list-item[data-thread-id="${threadId}"]`);
            if (activeLi) activeLi.classList.add('active');
            return;
        }

        try {
            const response = await fetch('/switch_chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: threadId }),
            });
            if (!response.ok) {
                const errData = await response.json();
                console.error('Failed to switch chat:', errData.error);
                addMessage(`Error: Could not switch chat. ${errData.error || ''}`, false);
                return;
            }
            const data = await response.json();
            
            currentActiveThreadId = data.active_thread_id;
            clearMessagesUI();
            data.messages.forEach(msg => {
                addMessage(msg.content, msg.type === 'human');
            });

            if (data.messages.length === 0 && data.chats[0].title === 'New Conversation' && data.chats[0].thread_id === threadId) {
                 displayInitialAIMessage(); // Display initial greeting for a brand new, empty "New Conversation"
            }
            
            renderSidebar(data.chats, data.active_thread_id); // Re-render sidebar to reflect new order and active state
            userInput.focus();

        } catch (error) {
            console.error('Error switching chat:', error);
            addMessage('Error: Could not connect to server to switch chat.', false);
        }
    }

    // Function to create and add a message to the chat
    function addMessage(text, isSent = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const timeText = getCurrentTime(); // Always use current time for new messages
        
        messageDiv.innerHTML = `
            <div class="message-bubble">
                <div class="message-text">${text}</div>
            </div>
            <div class="message-time">${timeText}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Function to create and add a typing indicator
    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Function to remove typing indicator
    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    // Function to send message to backend and get response
    async function sendMessage(message) {
        try {
            showTypingIndicator();
            
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: message }),
            });
            
            const data = await response.json();
            
            removeTypingIndicator();
            
            if (data.error) {
                addMessage(`Error: ${data.error}`, false);
            } else {
                if (data.response) {
                    addMessage(data.response, false);
                }
                if (data.chats && data.active_thread_id) { // If title was updated, server sends back new chat list
                    renderSidebar(data.chats, data.active_thread_id);
                }
            }
        } catch (error) {
            removeTypingIndicator();
            addMessage(`Sorry, there was an error communicating with the server.`, false);
            console.error('Error:', error);
        }
    }
    
    // Send message when button is clicked or Enter key is pressed
    function handleSendMessage() {
        const message = userInput.value.trim();
        if (message) {
            addMessage(message, true);
            userInput.value = '';
            sendMessage(message); // This will handle sidebar update if title changes
            
            sendButton.classList.remove('active');
        }
    }
    
    // Add pressed effect to send button on click
    sendButton.addEventListener('mousedown', function() {
        if (userInput.value.trim()) {
            this.style.transform = 'scale(0.9)';
        }
    });
    
    sendButton.addEventListener('mouseup', function() {
        this.style.transform = 'scale(1)';
    });
    
    // Event listeners
    sendButton.addEventListener('click', handleSendMessage);
    
    userInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    });
    
    // Enable/disable send button based on input
    userInput.addEventListener('input', function() {
        if (userInput.value.trim()) {
            sendButton.classList.add('active');
        } else {
            sendButton.classList.remove('active');
        }
    });
    
    // Focus input on page load
    setTimeout(() => {
        userInput.focus();
    }, 500);

    // New Chat button functionality
    if (newChatButton) {
        newChatButton.addEventListener('click', async function() {
            let responseFromServer; // To store the response object for logging in catch block
            try {
                responseFromServer = await fetch('/new_chat', { method: 'POST' });
                
                const responseText = await responseFromServer.clone().text();
                console.log("Raw response from /new_chat:", responseText);

                if (!responseFromServer.ok) {
                    console.error('Failed to start a new chat session on the server. Status:', responseFromServer.status, 'Response Text:', responseText);
                    addMessage(`Error: Could not start a new chat session (Status: ${responseFromServer.status}). Check console for details.`, false);
                    return;
                }
                
                const data = await responseFromServer.json(); 
                
                // --- Start Enhanced Debug Logging of Parsed Data ---
                console.log("Parsed data from /new_chat:", data);
                if (data && data.chats && data.active_thread_id) {
                    console.log("Parsed data.chats:", data.chats);
                    console.log("Parsed data.active_thread_id:", data.active_thread_id);
                } else {
                    console.error("Parsed data from /new_chat is missing expected 'chats' or 'active_thread_id' properties:", data);
                    addMessage('Error: Server response for new chat is malformed. Check console.', false);
                    return; // Stop further processing if data structure is wrong
                }
                // --- End Enhanced Debug Logging of Parsed Data ---
                                
                clearMessagesUI();
                displayInitialAIMessage();
                renderSidebar(data.chats, data.active_thread_id);
                currentActiveThreadId = data.active_thread_id; // Update global active ID

            } catch (error) {
                console.error('Error processing /new_chat response:', error); // Logs the actual error (e.g., JSON parsing error)
                if (responseFromServer) {
                    console.error('Response status that led to error (if available):', responseFromServer.status);
                    // The raw responseText is already logged above if fetch itself didn't fail.
                    // If .clone().text() failed, that would also land here.
                }
                addMessage('Error: Could not process server response for new chat. Check console.', false);
            }
            userInput.focus(); // Refocus on input
        });
    }

    // Initial setup on page load
    currentChats = typeof initialChats !== 'undefined' ? initialChats : [];
    currentActiveThreadId = typeof initialActiveThreadId !== 'undefined' ? initialActiveThreadId : null;

    renderSidebar(currentChats, currentActiveThreadId);

    if (currentActiveThreadId) {
        const activeChat = currentChats.find(c => c.thread_id === currentActiveThreadId);
        if (activeChat && activeChat.title === 'New Conversation') {
            // Check if messages container is empty (beyond timestamp)
            let messageCount = 0;
            for(let i=0; i < messagesContainer.children.length; i++){
                if(messagesContainer.children[i].classList.contains('message')){
                    messageCount++;
                }
            }
            if(messageCount === 0) { // Only display initial if no messages loaded by /switch_chat
                 displayInitialAIMessage();
            } else { // Messages were loaded by switch_chat (e.g. page refresh on existing new conv)
                // Do nothing, messages are already there
            }
        } else {
            // For existing chats, load their history
            handleSwitchChat(currentActiveThreadId);
        }
    } else if (currentChats.length > 0) {
        // Fallback if no active ID but chats exist, activate the first one
        handleSwitchChat(currentChats[0].thread_id);
    } else {
        // Truly empty state, no chats from server (should be handled by backend creating one)
        // For safety, if newChatButton exists, simulate a click or directly call its logic
        // This path should ideally not be hit if backend ensures a chat always exists.
        console.warn("Initial state has no active chat and no chats. Consider backend default.");
        displayInitialAIMessage(); // Display a greeting anyway
    }
    
    userInput.focus();
});