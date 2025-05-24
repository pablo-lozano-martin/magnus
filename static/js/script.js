document.addEventListener('DOMContentLoaded', function() {
    const messagesContainer = document.getElementById('messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const emojiElement = document.querySelector('.emoji');
    const newChatButton = document.getElementById('new-chat-button');
    const chatListUL = document.querySelector('.chat-list');
    const aiModelDisplay = document.getElementById('ai-model-display');

    let currentChats = [];
    let currentActiveThreadId = null;
    
    const TEMP_NEW_CHAT_ID = 'temp-new-chat-placeholder';
    const NEW_CHAT_PLACEHOLDER_ICON_JS = '📝';

    let globalOptionsMenu = null;
    let currentOpenMenuChatContext = null;

    // Modal Elements
    const renameModalBackdrop = document.getElementById('rename-modal-backdrop');
    const renameModalDialog = document.getElementById('rename-modal-dialog');
    const renameModalInput = document.getElementById('rename-modal-input');
    const renameModalCancelButton = document.getElementById('rename-modal-cancel');
    const renameModalSaveButton = document.getElementById('rename-modal-save');
    let renameContext = { thread_id: null, current_title: '' };

    // Settings Menu Elements
    const settingsButton = document.getElementById('settings-button');
    const settingsMenu = document.getElementById('settings-menu');
    const settingsThemeItem = document.getElementById('settings-theme-item');
    const themeSubmenu = document.getElementById('theme-submenu');
    let themeSubmenuTimeout;

    // Models Modal Elements
    const modelsModalBackdrop = document.getElementById('models-modal-backdrop');
    const modelsModalDialog = document.getElementById('models-modal-dialog');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const geminiModelSelect = document.getElementById('gemini-model-select');
    const modelsModalCancelButton = document.getElementById('models-modal-cancel');
    const modelsModalSaveButton = document.getElementById('models-modal-save');
    const toggleApiVisibilityButton = document.getElementById('toggle-api-visibility');
    const settingsModelsItem = document.getElementById('settings-models-item');
    const modelTabButtons = document.querySelectorAll('.models-modal-tab-button');
    const modelTabContents = document.querySelectorAll('.models-modal-tab-content');
    const ollamaModelSelect = document.getElementById('ollama-model-select');
    const refreshOllamaModelsButton = document.getElementById('refresh-ollama-models');
    const ollamaStatusText = document.getElementById('ollama-status-text');
    const geminiApiKeyContainer = document.getElementById('gemini-api-key-container');

    // Advanced Settings Modal Elements
    const advancedModalBackdrop = document.getElementById('advanced-modal-backdrop');
    const advancedModalDialog = document.getElementById('advanced-modal-dialog');
    const advancedModalCloseButton = document.getElementById('advanced-modal-close');
    const settingsAdvancedItem = document.getElementById('settings-advanced-item');
    const advancedTabButtons = document.querySelectorAll('.advanced-modal-tab-button');
    const advancedTabContents = document.querySelectorAll('.advanced-modal-tab-content');
    const deleteAllChatsButton = document.getElementById('delete-all-chats');

    // Local storage keys
    const GEMINI_API_KEY = 'geminiApiKey';
    const GEMINI_MODEL = 'geminiModel';
    const OLLAMA_SELECTED_MODEL = 'ollamaSelectedModel';
    const ACTIVE_MODEL_PROVIDER = 'activeModelProvider';
    const THEME_KEY = 'selectedTheme';

    // Input history management
    const inputHistories = {};
    let historyIndex = 0;

    // --- Helper Functions ---
    function getModelDisplayName(modelId, provider) {
        if (!modelId) {
            return provider === 'ollama' ? "Default Ollama Model" : "Gemini 1.5 Flash";
        }
        
        if (provider === 'ollama') {
            // For Ollama models, preserve the full model name including version
            // but make it more readable by capitalizing the base name
            if (modelId.includes(':')) {
                const [baseName, version] = modelId.split(':');
                const formattedBaseName = baseName
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                return `${formattedBaseName} ${version}`;
            } else {
                // If there's no version specifier, just format the base name
                return modelId
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            }
        }
        
        // Gemini models formatting remains the same
        return modelId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    function updateChatHeaderModelText() {
        const activeProvider = localStorage.getItem(ACTIVE_MODEL_PROVIDER) || 'gemini';
        let modelId, displayName;
        
        if (activeProvider === 'ollama') {
            modelId = localStorage.getItem(OLLAMA_SELECTED_MODEL);
            displayName = modelId ? getModelDisplayName(modelId, activeProvider) : "Ollama Model";
        } else {
            modelId = localStorage.getItem(GEMINI_MODEL) || 'gemini-1.5-flash';
            displayName = getModelDisplayName(modelId, activeProvider);
        }
        
        if (aiModelDisplay) {
            aiModelDisplay.textContent = `AI Powered by ${displayName}`;
        }
    }

    // --- Theme Management ---
    function applyTheme(theme) {
        if (theme === 'system') {
            document.documentElement.removeAttribute('data-theme');
            localStorage.removeItem(THEME_KEY);
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem(THEME_KEY, theme);
        }
    }

    function loadAndApplyInitialTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
            applyTheme(savedTheme);
        } else {
            applyTheme('system');
        }
    }
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        const currentThemePreference = localStorage.getItem(THEME_KEY);
        if (!currentThemePreference) {
            applyTheme('system');
        }
    });

    // --- Options Menu Management ---
    function ensureGlobalOptionsMenu() {
        if (globalOptionsMenu) return;

        globalOptionsMenu = document.createElement('div');
        globalOptionsMenu.className = 'chat-item-options-menu';
        globalOptionsMenu.innerHTML = `
            <a href="#" data-action="pin_toggle"><i class="fa-solid fa-thumbtack"></i> Pin</a>
            <a href="#" data-action="rename"><i class="fa-solid fa-pen-to-square"></i> Rename</a>
            <a href="#" data-action="delete"><i class="fa-solid fa-trash-can"></i> Delete</a>
        `;
        document.body.appendChild(globalOptionsMenu);

        globalOptionsMenu.querySelectorAll('a').forEach(optionLink => {
            optionLink.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const action = event.currentTarget.dataset.action;
                
                if (!currentOpenMenuChatContext) {
                    hideGlobalOptionsMenu();
                    return;
                }
                
                const { thread_id, title, is_pinned } = currentOpenMenuChatContext;
                
                if (action === 'delete') {
                    handleDeleteChat(thread_id, title);
                } else if (action === 'rename') {
                    handleRenameChat(thread_id, title);
                } else if (action === 'pin_toggle') {
                    handleTogglePinChat(thread_id);
                }
                hideGlobalOptionsMenu();
            });
        });
    }

    function showGlobalOptionsMenu(chatContext, buttonElement) {
        ensureGlobalOptionsMenu();
        currentOpenMenuChatContext = chatContext;

        const pinToggleLink = globalOptionsMenu.querySelector('a[data-action="pin_toggle"]');
        if (pinToggleLink) {
            pinToggleLink.innerHTML = chatContext.is_pinned ? 
                `<i class="fa-solid fa-thumbtack"></i> Unpin` : 
                `<i class="fa-solid fa-thumbtack"></i> Pin`;
        }

        const rect = buttonElement.getBoundingClientRect();
        let top = rect.top + window.scrollY + (rect.height / 2) - (globalOptionsMenu.offsetHeight / 2);
        let left = rect.right + window.scrollX + 5;

        // Boundary checks
        if (left + globalOptionsMenu.offsetWidth > window.innerWidth) {
            left = rect.left + window.scrollX - globalOptionsMenu.offsetWidth - 5;
        }
        if (top + globalOptionsMenu.offsetHeight > window.innerHeight) {
            top = window.innerHeight - globalOptionsMenu.offsetHeight - 5 - window.scrollY;
        }
        if (top < window.scrollY) {
            top = window.scrollY + 5;
        }

        globalOptionsMenu.style.top = `${top}px`;
        globalOptionsMenu.style.left = `${left}px`;
        globalOptionsMenu.classList.add('visible');
    }

    function hideGlobalOptionsMenu() {
        if (globalOptionsMenu) {
            globalOptionsMenu.classList.remove('visible');
        }
        currentOpenMenuChatContext = null;
    }

    // --- Chat Management Functions ---
    async function handleRenameChat(thread_id, current_title) {
        renameContext = { thread_id, current_title };
        renameModalInput.value = current_title;
        renameModalInput.placeholder = current_title || "Enter new chat name";
        
        renameModalBackdrop.style.display = 'block';
        renameModalDialog.style.display = 'flex';
        document.body.classList.add('modal-open-blur');
        renameModalInput.focus();
        renameModalInput.select();
    }

    function hideRenameModal() {
        renameModalBackdrop.style.display = 'none';
        renameModalDialog.style.display = 'none';
        document.body.classList.remove('modal-open-blur');
        renameModalInput.value = '';
        renameContext = { thread_id: null, current_title: '' };
    }

    async function processRename() {
        const newTitle = renameModalInput.value.trim();
        const { thread_id, current_title } = renameContext;

        if (newTitle && newTitle !== current_title) {
            try {
                const response = await fetch('/rename_chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ thread_id: thread_id, new_title: newTitle }),
                });
                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'Failed to rename chat.');
                }
                const data = await response.json();
                currentChats = data.chats;
                if (data.active_thread_id !== undefined) {
                    currentActiveThreadId = data.active_thread_id;
                }
                renderSidebar(currentChats, currentActiveThreadId);
            } catch (error) {
                console.error('Error renaming chat:', error);
                addMessage(`Error: ${error.message}`, false);
            } finally {
                hideRenameModal();
            }
        } else if (newTitle === current_title) {
            hideRenameModal(); // No change, just close
        } else if (!newTitle) {
            // Show inline error instead of alert
            const errorMsg = document.createElement('div');
            errorMsg.className = 'rename-error';
            errorMsg.textContent = 'Chat name cannot be empty';
            
            // Remove any existing error message
            const existingError = renameModalDialog.querySelector('.rename-error');
            if (existingError) {
                existingError.remove();
            }
            
            // Insert error before actions
            const actionsDiv = renameModalDialog.querySelector('.rename-modal-actions');
            renameModalDialog.insertBefore(errorMsg, actionsDiv);
            
            // Focus the input
            renameModalInput.focus();
            
            // Remove error message after 3 seconds
            setTimeout(() => {
                if (errorMsg.parentNode) {
                    errorMsg.remove();
                }
            }, 3000);
        }
    }

    async function handleTogglePinChat(thread_id) {
        try {
            const response = await fetch('/toggle_pin_chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: thread_id }),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to toggle pin status.');
            }
            const data = await response.json();
            currentChats = data.chats;
            if (data.active_thread_id !== undefined) {
                currentActiveThreadId = data.active_thread_id;
            }
            renderSidebar(currentChats, currentActiveThreadId);
        } catch (error) {
            console.error('Error toggling pin status:', error);
            addMessage(`Error: ${error.message}`, false);
        }
    }

    async function handleDeleteChat(thread_id, title) {
        try {
            const response = await fetch('/delete_chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: thread_id }),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to delete chat.');
            }
            const data = await response.json();
            
            const wasActive = (thread_id === currentActiveThreadId);
            
            currentChats = data.chats;
            currentActiveThreadId = data.active_thread_id;

            renderSidebar(currentChats, currentActiveThreadId);

            if (wasActive) {
                if (currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                    handleSwitchChat(currentActiveThreadId);
                } else {
                    handleSwitchChat(TEMP_NEW_CHAT_ID);
                }
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
            addMessage(`Error: ${error.message}`, false);
        }
    }

    // --- Emoji Management ---
    const emojis = [
        '🧠', '🤖', '💡', '✨', '🔮', '👾', '🚀', '🌟', '🔭', '🦄', 
        '🔍', '💬', '💭', '🎯', '⚡️', '🌐', '🧩', '🧪', '🍀', '☀️'
    ];
    
    function getRandomEmoji(currentEmoji) {
        let newEmoji;
        do {
            newEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        } while (newEmoji === currentEmoji);
        return newEmoji;
    }
    
    document.querySelector('.logo-icon').addEventListener('click', function() {
        const currentEmoji = emojiElement.textContent;
        const newEmoji = getRandomEmoji(currentEmoji);
        
        emojiElement.classList.add('emoji-rotate-out');
        
        setTimeout(() => {
            emojiElement.textContent = newEmoji;
            emojiElement.classList.remove('emoji-rotate-out');
            emojiElement.classList.add('emoji-rotate-in');
            
            setTimeout(() => {
                emojiElement.classList.remove('emoji-rotate-in');
            }, 150);
        }, 150);
    });
    
    // --- Time and Date Functions ---
    function getCurrentTime() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    
    function getFormattedDate() {
        const options = { month: 'long', day: 'numeric', year: 'numeric' };
        return new Date().toLocaleDateString('en-US', options);
    }
    
    // Update timestamp
    const timestampDiv = document.querySelector('.message-timestamp');
    timestampDiv.textContent = getFormattedDate();

    // --- Message Management ---
    function clearMessagesUI() {
        while (messagesContainer.children.length > 1) {
            if (messagesContainer.lastChild.classList.contains('message') || messagesContainer.lastChild.id === 'typing-indicator') {
                messagesContainer.removeChild(messagesContainer.lastChild);
            } else {
                break; 
            }
        }
    }

    function displayInitialAIMessage() {
        // Remove the initial greeting message completely
        // The function is kept empty to maintain code structure in case other initialization is needed later
    }

    function addMessage(text, isSent = true, thinkingContent = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const timeText = getCurrentTime();
        let messageHTML = '';
        
        // Process text content based on sender
        let processedText = text;
        if (!isSent) {
            // For AI responses, parse markdown
            // Configure marked with options for GitHub Flavored Markdown
            marked.setOptions({
                gfm: true,
                breaks: true,
                sanitize: false, // Allow HTML
                smartLists: true,
                smartypants: true
            });
            
            processedText = marked.parse(text);
        } else {
            // For user-sent messages, escape HTML but preserve line breaks
            processedText = escapeHtml(text).replace(/\n/g, '<br>');
        }
        
        if (thinkingContent && !isSent) {
            messageHTML = `
                <div class="message-bubble">
                    <div class="thinking-component">
                        <div class="thinking-header" onclick="toggleThinking(this)">
                            <i class="fa-solid fa-brain thinking-icon"></i>
                            <span class="thinking-label">Show thinking</span>
                            <i class="fa-solid fa-chevron-down thinking-toggle"></i>
                        </div>
                        <div class="thinking-content" style="display: none;">
                            <div class="thinking-text">${thinkingContent.replace(/\n/g, '<br>')}</div>
                        </div>
                    </div>
                    <div class="message-text markdown-content">${processedText}</div>
                </div>
                <div class="message-time">${timeText}</div>
            `;
        } else {
            messageHTML = `
                <div class="message-bubble">
                    <div class="message-text ${!isSent ? 'markdown-content' : ''}">${processedText}</div>
                </div>
                <div class="message-time">${timeText}</div>
            `;
        }
        
        messageDiv.innerHTML = messageHTML;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.toggleThinking = function(header) {
        const content = header.nextElementSibling;
        const toggle = header.querySelector('.thinking-toggle');
        const isVisible = content.style.display !== 'none';
        
        if (isVisible) {
            content.style.display = 'none';
            toggle.style.transform = 'rotate(0deg)';
            header.querySelector('.thinking-label').textContent = 'Show thinking';
        } else {
            content.style.display = 'block';
            toggle.style.transform = 'rotate(180deg)';
            header.querySelector('.thinking-label').textContent = 'Hide thinking';
        }
    };

    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    // --- Sidebar Rendering ---
    function renderSidebar(chatsFromServer, activeThreadIdToSet) {
        chatListUL.innerHTML = '';
        currentChats = chatsFromServer;
        currentActiveThreadId = activeThreadIdToSet;

        if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
            const tempListItem = document.createElement('li');
            tempListItem.className = 'chat-list-item active';
            tempListItem.dataset.threadId = TEMP_NEW_CHAT_ID;
            tempListItem.innerHTML = `
                <span class="chat-item-icon">${NEW_CHAT_PLACEHOLDER_ICON_JS}</span>
                <span class="chat-item-text">New Conversation</span>
                <span class="chat-item-time">Now</span>
                <div class="chat-item-options-button" style="display:none;">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </div>`;
            tempListItem.addEventListener('click', () => {
                if (currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                    handleSwitchChat(TEMP_NEW_CHAT_ID);
                } else {
                    userInput.focus();
                }
            });
            chatListUL.appendChild(tempListItem);
        }

        currentChats.forEach(chat => {
            const listItem = document.createElement('li');
            listItem.className = 'chat-list-item';
            listItem.dataset.threadId = chat.thread_id;

            if (chat.thread_id === currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                listItem.classList.add('active');
            }

            if (chat.is_pinned) {
                listItem.classList.add('pinned');
            }

            let timeDisplay = chat.time || '';
            if (chat.thread_id === currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                timeDisplay = chat.time || ''; 
            }

            listItem.innerHTML = `
                <span class="chat-item-icon">${chat.icon || '📄'}</span>
                <span class="chat-item-text">${chat.title}</span>
                <span class="chat-item-time">${timeDisplay}</span>
                <div class="chat-item-options-button">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </div>
            `;
            
            listItem.addEventListener('click', (event) => {
                if (!event.target.closest('.chat-item-options-button')) {
                    handleSwitchChat(chat.thread_id);
                }
            });

            const optionsButton = listItem.querySelector('.chat-item-options-button');
            if (optionsButton) {
                optionsButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const chatContext = { thread_id: chat.thread_id, title: chat.title, is_pinned: chat.is_pinned };
                    if (globalOptionsMenu && globalOptionsMenu.classList.contains('visible') && currentOpenMenuChatContext && currentOpenMenuChatContext.thread_id === chat.thread_id) {
                        hideGlobalOptionsMenu();
                    } else {
                        hideGlobalOptionsMenu();
                        showGlobalOptionsMenu(chatContext, optionsButton);
                    }
                });
            }
            chatListUL.appendChild(listItem);
        });
    }

    // Global click listener to close open menus when clicking outside
    document.addEventListener('click', function(event) {
        if (globalOptionsMenu && globalOptionsMenu.classList.contains('visible')) {
            let clickedOnAnOptionsButton = false;
            document.querySelectorAll('.chat-item-options-button').forEach(button => {
                if (button.contains(event.target)) {
                    clickedOnAnOptionsButton = true;
                }
            });

            if (!globalOptionsMenu.contains(event.target) && !clickedOnAnOptionsButton) {
                 hideGlobalOptionsMenu();
            }
        }

        if (settingsMenu && settingsMenu.style.display === 'block') {
            if (!settingsMenu.contains(event.target) && event.target !== settingsButton && !settingsButton.contains(event.target)) {
                if (themeSubmenu && themeSubmenu.style.display === 'block' && themeSubmenu.contains(event.target)) {
                } else {
                    hideSettingsMenus();
                }
            }
        }
        if (themeSubmenu && themeSubmenu.style.display === 'block') {
            if (!themeSubmenu.contains(event.target) && event.target !== settingsThemeItem && !settingsThemeItem.contains(event.target)) {
                 themeSubmenu.style.display = 'none';
            }
        }
    });

    // Function to handle switching chats
    async function handleSwitchChat(threadId) {
        console.log(`handleSwitchChat called for threadId: ${threadId}. Current active global: ${currentActiveThreadId}`);

        if (threadId === TEMP_NEW_CHAT_ID) {
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID && messagesContainer.querySelector('.message')) {
                userInput.focus();
                return;
            }
            clearMessagesUI();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID);
            userInput.focus();
            return;
        }

        const hasMessages = messagesContainer.querySelector('.message') !== null;
        if (threadId === currentActiveThreadId && hasMessages) {
            console.log("handleSwitchChat: Real chat already active and populated. Returning early.");
            document.querySelectorAll('.chat-list-item').forEach(item => item.classList.remove('active'));
            const activeLi = chatListUL.querySelector(`.chat-list-item[data-thread-id="${threadId}"]`);
            if (activeLi) activeLi.classList.add('active');
            userInput.focus();
            return;
        }
        
        console.log("handleSwitchChat: Proceeding to fetch and update for REAL chat.");
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
            console.log("handleSwitchChat: Received data from /switch_chat:", data);
            
            currentActiveThreadId = data.active_thread_id;
            console.log(`handleSwitchChat: currentActiveThreadId updated to: ${currentActiveThreadId}`);

            clearMessagesUI();
            data.messages.forEach(msg => {
                addMessage(msg.content, msg.type === 'human');
            });

            if (data.messages.length === 0 && 
                data.chats && data.chats.length > 0) {
                const switchedToChat = data.chats.find(c => c.thread_id === threadId);
                if (switchedToChat && switchedToChat.title === 'New Conversation') {
                    console.log("handleSwitchChat: Switched to a real chat titled 'New Conversation' with no messages. No greeting displayed.");
                }
            }
            
            renderSidebar(data.chats, data.active_thread_id || threadId);

            const userHistory = (data.messages || [])
                .filter(msg => msg.type === 'human')
                .map(msg => msg.content);
            inputHistories[threadId] = userHistory;
            historyIndex = userHistory.length;

            userInput.focus();

        } catch (error) {
            console.error('Error switching chat:', error);
            addMessage('Error: Could not connect to server to switch chat.', false);
        }
    }

    // Function to send message to backend and get response
    async function sendMessage(message) {
        try {
            showTypingIndicator();
            
            let payloadThreadId = currentActiveThreadId;
            let isPlaceholderChat = false;
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
                payloadThreadId = null;
                isPlaceholderChat = true;
            }

            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: message, thread_id: payloadThreadId }),
            });
            
            const data = await response.json();
            removeTypingIndicator();
            
            if (data.error) {
                addMessage(`Error: ${data.error}`, false);
            } else {
                if (data.response) {
                    if (data.has_thinking && data.thinking) {
                        console.log('Adding message with thinking content:', data.thinking.substring(0, 100) + '...');
                        addMessage(data.response, false, data.thinking);
                    } else {
                        addMessage(data.response, false);
                    }
                }
                if (isPlaceholderChat && data.newly_created_thread_id) {
                    console.log(`New chat materialized from placeholder: ${data.newly_created_thread_id}`);
                    currentActiveThreadId = data.newly_created_thread_id;
                    currentChats = data.chats;
                    renderSidebar(currentChats, currentActiveThreadId);
                } else if (data.chats) {
                    console.log("Received updated chats from server (title change or new chat).");
                    currentChats = data.chats;
                    currentActiveThreadId = data.active_thread_id;
                    renderSidebar(currentChats, currentActiveThreadId);
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
            if (!inputHistories[currentActiveThreadId]) inputHistories[currentActiveThreadId] = [];
            inputHistories[currentActiveThreadId].push(message);
            historyIndex = inputHistories[currentActiveThreadId].length;

            addMessage(message, true);
            userInput.value = '';
            sendMessage(message);
            
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

    userInput.addEventListener('keydown', function(event) {
        const hist = inputHistories[currentActiveThreadId] || [];
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && hist.length) {
            event.preventDefault();
            if (event.key === 'ArrowUp' && historyIndex > 0) {
                historyIndex--;
            } else if (event.key === 'ArrowDown' && historyIndex < hist.length) {
                historyIndex++;
            }
            userInput.value = hist[historyIndex] || '';
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
            console.log("New Chat button clicked. Current active: ", currentActiveThreadId);
            
            clearMessagesUI();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID);

            if (!inputHistories[TEMP_NEW_CHAT_ID]) inputHistories[TEMP_NEW_CHAT_ID] = [];
            historyIndex = inputHistories[TEMP_NEW_CHAT_ID].length;
            userInput.focus();
        });
    }

    // Initial setup on page load
    ensureGlobalOptionsMenu(); 
    loadAndApplyInitialTheme();

    function setInitialModelDisplay() {
        if (typeof currentProvider !== 'undefined' && typeof currentModel !== 'undefined') {
            localStorage.setItem(ACTIVE_MODEL_PROVIDER, currentProvider);
            if (currentProvider === 'gemini') {
                localStorage.setItem(GEMINI_MODEL, currentModel);
            } else if (currentProvider === 'ollama') {
                localStorage.setItem(OLLAMA_SELECTED_MODEL, currentModel);
            }
            
            const displayName = getModelDisplayName(currentModel, currentProvider);
            if (aiModelDisplay) {
                aiModelDisplay.textContent = `AI Powered by ${displayName}`;
            }
        } else {
            syncModelDisplayWithBackend();
        }
    }

    setInitialModelDisplay();

    currentChats = typeof initialChats !== 'undefined' ? initialChats : [];
    currentActiveThreadId = typeof initialActiveThreadId !== 'undefined' ? initialActiveThreadId : null;

    if (currentActiveThreadId === null && currentChats.length === 0) { 
        console.log("Initial load: No real chats, activating placeholder.");
        currentActiveThreadId = TEMP_NEW_CHAT_ID;
        clearMessagesUI();
    }

    renderSidebar(currentChats, currentActiveThreadId);

    if (currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
        console.log("Initial load: Attempting to load real active chat:", currentActiveThreadId);
        handleSwitchChat(currentActiveThreadId); 
    } else if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
        console.log("Initial load: Placeholder chat is active.");
    } else if (!currentActiveThreadId && currentChats.length > 0) {
        console.log("Initial load: Has real chats, activating the first one.");
        currentActiveThreadId = currentChats[0].thread_id;
        handleSwitchChat(currentActiveThreadId);
    }
    
    userInput.focus();

    // --- Models Modal Tab Logic ---
    modelTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            modelTabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const targetTab = button.dataset.tab;
            modelTabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${targetTab}-tab-content`) {
                    content.classList.add('active');
                }
            });

            if (geminiApiKeyContainer) {
                geminiApiKeyContainer.style.display = targetTab === 'gemini' ? 'flex' : 'none';
            }

            if (targetTab === 'ollama') {
                fetchOllamaModels();
            }
        });
    });

    async function fetchOllamaModels() {
        if (!ollamaModelSelect || !ollamaStatusText) return;
        ollamaModelSelect.innerHTML = '<option value="">Fetching models...</option>';
        ollamaStatusText.textContent = 'Attempting to connect to Ollama...';
        try {
            const response = await fetch('/get_ollama_models');
            const rawResponseText = await response.text();

            if (!response.ok) {
                let errData;
                try {
                    errData = JSON.parse(rawResponseText);
                } catch (e) {
                    errData = { error: `Failed to fetch Ollama models. Status: ${response.status}. Response not JSON: ${rawResponseText}` };
                }
                throw new Error(errData.error || `Failed to fetch Ollama models. Status: ${response.status}`);
            }
            
            const data = JSON.parse(rawResponseText);
            
            ollamaModelSelect.innerHTML = '';
            
            let validModelsFound = 0;
            if (data && data.models && Array.isArray(data.models) && data.models.length > 0) {
                data.models.forEach(model => {
                    if (model && typeof model.name === 'string' && model.name.trim() !== '') {
                        const option = document.createElement('option');
                        option.value = model.name;
                        // Display the full model name in the dropdown
                        option.textContent = model.name;
                        ollamaModelSelect.appendChild(option);
                        validModelsFound++;
                    } else {
                        console.warn("Skipping invalid model entry from server:", model);
                    }
                });
            } else {
                console.warn("No valid 'models' array found in server response:", data);
            }

            if (validModelsFound > 0) {
                ollamaStatusText.textContent = `Found ${validModelsFound} model(s). Select one.`;
                const savedOllamaModel = localStorage.getItem(OLLAMA_SELECTED_MODEL);
                if (savedOllamaModel) {
                    const exists = Array.from(ollamaModelSelect.options).some(opt => opt.value === savedOllamaModel);
                    if (exists) {
                        ollamaModelSelect.value = savedOllamaModel;
                    } else {
                        localStorage.removeItem(OLLAMA_SELECTED_MODEL);
                    }
                }
            } else {
                ollamaModelSelect.innerHTML = '<option value="">No models found</option>';
                ollamaStatusText.textContent = 'No Ollama models found. Ensure Ollama is running and has models installed.';
            }
        } catch (error) {
            ollamaModelSelect.innerHTML = '<option value="">Error fetching</option>';
            ollamaStatusText.textContent = `Error: ${error.message}. Make sure Ollama is running.`;
        }
    }

    if (refreshOllamaModelsButton) {
        refreshOllamaModelsButton.addEventListener('click', fetchOllamaModels);
    }

    // --- Models Modal Functions ---
    function showModelsModal() {
        const activeProvider = localStorage.getItem(ACTIVE_MODEL_PROVIDER) || 'gemini';
        
        modelTabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeProvider);
        });
        modelTabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${activeProvider}-tab-content`);
        });
         if (geminiApiKeyContainer) {
            geminiApiKeyContainer.style.display = activeProvider === 'gemini' ? 'flex' : 'none';
        }

        const savedApiKey = localStorage.getItem(GEMINI_API_KEY) || '';
        const savedGeminiModel = localStorage.getItem(GEMINI_MODEL) || 'gemini-1.5-flash';
        geminiApiKeyInput.value = savedApiKey;
        geminiModelSelect.value = savedGeminiModel;

        if (activeProvider === 'ollama' || document.querySelector('.models-modal-tab-button[data-tab="ollama"].active')) {
            fetchOllamaModels(); 
        }
        
        modelsModalBackdrop.style.display = 'block';
        modelsModalDialog.style.display = 'flex';
        document.body.classList.add('modal-open-blur');
    }

    function hideModelsModal() {
        if (modelsModalBackdrop) modelsModalBackdrop.style.display = 'none';
        if (modelsModalDialog) modelsModalDialog.style.display = 'none';
        document.body.classList.remove('modal-open-blur');
    }

    async function saveModelSettings() {
        const activeTabButton = document.querySelector('.models-modal-tab-button.active');
        if (!activeTabButton) {
            return;
        }
        const activeProvider = activeTabButton.dataset.tab;

        // Function to show an inline error message
        function showModelError(message) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'modal-error-message';
            errorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;
            
            // Remove any existing error
            const existingError = modelsModalDialog.querySelector('.modal-error-message');
            if (existingError) {
                existingError.remove();
            }
            
            // Add to the modal before the actions
            const actionsDiv = modelsModalDialog.querySelector('.models-modal-actions');
            modelsModalDialog.insertBefore(errorMsg, actionsDiv);
            
            // Remove after 4 seconds
            setTimeout(() => {
                if (errorMsg.parentNode) {
                    errorMsg.remove();
                }
            }, 4000);
        }

        if (activeProvider === 'gemini') {
            const apiKey = geminiApiKeyInput.value.trim();
            const modelName = geminiModelSelect.value;
            
            if (!apiKey) {
                showModelError("Gemini API key cannot be empty");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        api_key: apiKey,
                        model_name: modelName,
                        provider: 'gemini'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Gemini settings');
                }
                
                localStorage.setItem(GEMINI_API_KEY, apiKey);
                localStorage.setItem(GEMINI_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'gemini');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show a success message in the chat
                addMessage(`Model updated to ${getModelDisplayName(modelName, 'gemini')}`, false);

            } catch (error) {
                showModelError(error.message);
            }

        } else if (activeProvider === 'ollama') {
            const modelName = ollamaModelSelect.value;
            if (!modelName) {
                showModelError("Please select an Ollama model");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model_name: modelName,
                        provider: 'ollama'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Ollama settings');
                }
                
                localStorage.setItem(OLLAMA_SELECTED_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'ollama');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show a success message in the chat
                addMessage(`Model updated to ${getModelDisplayName(modelName, 'ollama')}`, false);

            } catch (error) {
                showModelError(error.message);
            }
        }
    }

    // Toggle API key visibility
    if (toggleApiVisibilityButton) {
        toggleApiVisibilityButton.addEventListener('click', function() {
            const icon = toggleApiVisibilityButton.querySelector('i');
            
            if (geminiApiKeyInput.type === 'password') {
                geminiApiKeyInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                geminiApiKeyInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Event listeners for Models Modal
    if (settingsModelsItem) {
        settingsModelsItem.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            hideSettingsMenus();
            showModelsModal();
        });
    }

    if (modelsModalSaveButton) {
        modelsModalSaveButton.addEventListener('click', saveModelSettings);
    }

    if (modelsModalCancelButton) {
        modelsModalCancelButton.addEventListener('click', hideModelsModal);
    }

    if (modelsModalBackdrop) {
        modelsModalBackdrop.addEventListener('click', hideModelsModal);
    }

    if (modelsModalBackdrop) {
        modelsModalBackdrop.addEventListener('click', hideModelsModal);
    }

    // Add to the existing document keydown listener
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (renameModalDialog.style.display === 'flex') {
                hideRenameModal();
            }
            if (modelsModalDialog.style.display === 'flex') {
                hideModelsModal();
            }
            if (advancedModalDialog.style.display === 'flex') {
                hideAdvancedModal();
            }
        }
    });

    // --- Settings Menu Logic ---
    function positionMenuAboveButton(menuElement, buttonElement) {
        const buttonRect = buttonElement.getBoundingClientRect();
        menuElement.style.bottom = (window.innerHeight - buttonRect.top + 10) + 'px';
        menuElement.style.left = buttonRect.left + 'px';
        menuElement.style.width = buttonRect.width + 'px';
    }

    function positionSubmenuToSide(submenuElement, parentItemElement) {
        const parentRect = parentItemElement.getBoundingClientRect();
        submenuElement.style.top = parentRect.top + 'px';
        submenuElement.style.left = parentRect.right + 5 + 'px';
    }

    function hideSettingsMenus() {
        if (settingsMenu) settingsMenu.style.display = 'none';
        if (themeSubmenu) themeSubmenu.style.display = 'none';
    }

    if (settingsButton && settingsMenu) {
        settingsButton.addEventListener('click', function(event) {
            event.stopPropagation();
            const isMenuVisible = settingsMenu.style.display === 'block';
            hideGlobalOptionsMenu();

            if (!isMenuVisible) {
                if (themeSubmenu) themeSubmenu.style.display = 'none';
                settingsMenu.style.display = 'block';
                positionMenuAboveButton(settingsMenu, settingsButton);
            } else {
                hideSettingsMenus();
            }
        });
    }

    if (settingsThemeItem && themeSubmenu) {
        settingsThemeItem.addEventListener('mouseenter', function(event) {
            clearTimeout(themeSubmenuTimeout);
            themeSubmenu.style.display = 'block';
            positionSubmenuToSide(themeSubmenu, settingsThemeItem);
        });

        settingsThemeItem.addEventListener('mouseleave', function(event) {
            themeSubmenuTimeout = setTimeout(() => {
                themeSubmenu.style.display = 'none';
            }, 200);
        });

        themeSubmenu.addEventListener('mouseenter', function(event) {
            clearTimeout(themeSubmenuTimeout);
        });

        themeSubmenu.addEventListener('mouseleave', function(event) {
            themeSubmenu.style.display = 'none';
        });
    }

    if (settingsMenu) {
        settingsMenu.querySelectorAll('.settings-menu-item').forEach(item => {
            item.addEventListener('click', function(event) {
                const action = this.dataset.action;
                if (action && action !== 'theme' && action !== 'models' && action !== 'advanced') {
                    event.preventDefault();
                    console.log(`Settings action: ${action}`);
                    hideSettingsMenus();
                }
            });
        });
    }
    
    if (themeSubmenu) {
        themeSubmenu.querySelectorAll('.settings-menu-item[data-theme]').forEach(item => {
            item.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                const themeValue = this.dataset.theme;
                applyTheme(themeValue);
                hideSettingsMenus();
            });
        });
    }

    // Global click listener to close open menus when clicking outside
    document.addEventListener('click', function(event) {
        if (globalOptionsMenu && globalOptionsMenu.classList.contains('visible')) {
            let clickedOnAnOptionsButton = false;
            document.querySelectorAll('.chat-item-options-button').forEach(button => {
                if (button.contains(event.target)) {
                    clickedOnAnOptionsButton = true;
                }
            });

            if (!globalOptionsMenu.contains(event.target) && !clickedOnAnOptionsButton) {
                 hideGlobalOptionsMenu();
            }
        }

        // Close settings menus if click is outside
        if (settingsMenu && settingsMenu.style.display === 'block') {
            if (!settingsMenu.contains(event.target) && event.target !== settingsButton && !settingsButton.contains(event.target)) {
                if (themeSubmenu && themeSubmenu.style.display === 'block' && themeSubmenu.contains(event.target)) {
                    // Click was inside the theme submenu, do nothing
                } else {
                    hideSettingsMenus();
                }
            }
        }
        
        if (themeSubmenu && themeSubmenu.style.display === 'block') {
            if (!themeSubmenu.contains(event.target) && event.target !== settingsThemeItem && !settingsThemeItem.contains(event.target)) {
                 themeSubmenu.style.display = 'none';
            }
        }
    });

    // --- Chat Management Functions ---
    async function handleSwitchChat(threadId) {
        console.log(`handleSwitchChat called for threadId: ${threadId}. Current active global: ${currentActiveThreadId}`);

        if (threadId === TEMP_NEW_CHAT_ID) {
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID && messagesContainer.querySelector('.message')) {
                userInput.focus();
                return;
            }
            clearMessagesUI();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID);
            userInput.focus();
            return;
        }

        const hasMessages = messagesContainer.querySelector('.message') !== null;
        if (threadId === currentActiveThreadId && hasMessages) {
            console.log("handleSwitchChat: Real chat already active and populated. Returning early.");
            document.querySelectorAll('.chat-list-item').forEach(item => item.classList.remove('active'));
            const activeLi = chatListUL.querySelector(`.chat-list-item[data-thread-id="${threadId}"]`);
            if (activeLi) activeLi.classList.add('active');
            userInput.focus();
            return;
        }
        
        console.log("handleSwitchChat: Proceeding to fetch and update for REAL chat.");
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
            console.log("handleSwitchChat: Received data from /switch_chat:", data);
            
            currentActiveThreadId = data.active_thread_id;
            console.log(`handleSwitchChat: currentActiveThreadId updated to: ${currentActiveThreadId}`);

            clearMessagesUI();
            data.messages.forEach(msg => {
                addMessage(msg.content, msg.type === 'human');
            });

            if (data.messages.length === 0 && 
                data.chats && data.chats.length > 0) {
                const switchedToChat = data.chats.find(c => c.thread_id === threadId);
                if (switchedToChat && switchedToChat.title === 'New Conversation') {
                    console.log("handleSwitchChat: Switched to a real chat titled 'New Conversation' with no messages. No greeting displayed.");
                }
            }
            
            renderSidebar(data.chats, data.active_thread_id || threadId);

            const userHistory = (data.messages || [])
                .filter(msg => msg.type === 'human')
                .map(msg => msg.content);
            inputHistories[threadId] = userHistory;
            historyIndex = userHistory.length;

            userInput.focus();

        } catch (error) {
            console.error('Error switching chat:', error);
            addMessage('Error: Could not connect to server to switch chat.', false);
        }
    }

    // --- Message sending and other functionality ---
    async function sendMessage(message) {
        try {
            showTypingIndicator();
            
            let payloadThreadId = currentActiveThreadId;
            let isPlaceholderChat = false;
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
                payloadThreadId = null;
                isPlaceholderChat = true;
            }

            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: message, thread_id: payloadThreadId }),
            });
            
            const data = await response.json();
            removeTypingIndicator();
            
            if (data.error) {
                addMessage(`Error: ${data.error}`, false);
            } else {
                if (data.response) {
                    if (data.has_thinking && data.thinking) {
                        console.log('Adding message with thinking content:', data.thinking.substring(0, 100) + '...');
                        addMessage(data.response, false, data.thinking);
                    } else {
                        addMessage(data.response, false);
                    }
                }
                if (isPlaceholderChat && data.newly_created_thread_id) {
                    console.log(`New chat materialized from placeholder: ${data.newly_created_thread_id}`);
                    currentActiveThreadId = data.newly_created_thread_id;
                    currentChats = data.chats;
                    renderSidebar(currentChats, currentActiveThreadId);
                } else if (data.chats) {
                    console.log("Received updated chats from server (title change or new chat).");
                    currentChats = data.chats;
                    currentActiveThreadId = data.active_thread_id;
                    renderSidebar(currentChats, currentActiveThreadId);
                }
            }
        } catch (error) {
            removeTypingIndicator();
            addMessage(`Sorry, there was an error communicating with the server.`, false);
            console.error('Error:', error);
        }
    }

    function handleSendMessage() {
        const message = userInput.value.trim();
        if (message) {
            if (!inputHistories[currentActiveThreadId]) inputHistories[currentActiveThreadId] = [];
            inputHistories[currentActiveThreadId].push(message);
            historyIndex = inputHistories[currentActiveThreadId].length;

            addMessage(message, true);
            userInput.value = '';
            sendMessage(message);
            
            sendButton.classList.remove('active');
        }
    }

    // Event listeners for send button and input
    sendButton.addEventListener('mousedown', function() {
        if (userInput.value.trim()) {
            this.style.transform = 'scale(0.9)';
        }
    });
    
    sendButton.addEventListener('mouseup', function() {
        this.style.transform = 'scale(1)';
    });
    
    sendButton.addEventListener('click', handleSendMessage);
    
    userInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            handleSendMessage();
        }
    });

    userInput.addEventListener('keydown', function(event) {
        const hist = inputHistories[currentActiveThreadId] || [];
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && hist.length) {
            event.preventDefault();
            if (event.key === 'ArrowUp' && historyIndex > 0) {
                historyIndex--;
            } else if (event.key === 'ArrowDown' && historyIndex < hist.length) {
                historyIndex++;
            }
            userInput.value = hist[historyIndex] || '';
        }
    });
    
    userInput.addEventListener('input', function() {
        if (userInput.value.trim()) {
            sendButton.classList.add('active');
        } else {
            sendButton.classList.remove('active');
        }
    });

    // New Chat button functionality
    if (newChatButton) {
        newChatButton.addEventListener('click', async function() {
            console.log("New Chat button clicked. Current active: ", currentActiveThreadId);
            
            clearMessagesUI();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID);

            if (!inputHistories[TEMP_NEW_CHAT_ID]) inputHistories[TEMP_NEW_CHAT_ID] = [];
            historyIndex = inputHistories[TEMP_NEW_CHAT_ID].length;
            userInput.focus();
        });
    }

    // --- Models Modal Functions ---
    async function fetchOllamaModels() {
        if (!ollamaModelSelect || !ollamaStatusText) return;
        ollamaModelSelect.innerHTML = '<option value="">Fetching models...</option>';
        ollamaStatusText.textContent = 'Attempting to connect to Ollama...';
        try {
            const response = await fetch('/get_ollama_models');
            const rawResponseText = await response.text();
            console.log("Raw response from /get_ollama_models:", rawResponseText);

            if (!response.ok) {
                let errData;
                try {
                    errData = JSON.parse(rawResponseText);
                } catch (e) {
                    errData = { error: `Failed to fetch Ollama models. Status: ${response.status}. Response not JSON: ${rawResponseText}` };
                }
                throw new Error(errData.error || `Failed to fetch Ollama models. Status: ${response.status}`);
            }
            
            const data = JSON.parse(rawResponseText);
            console.log("Parsed data from /get_ollama_models:", data);
            
            ollamaModelSelect.innerHTML = '';
            
            let validModelsFound = 0;
            if (data && data.models && Array.isArray(data.models) && data.models.length > 0) {
                data.models.forEach(model => {
                    if (model && typeof model.name === 'string' && model.name.trim() !== '') {
                        const option = document.createElement('option');
                        option.value = model.name;
                        // Display the full model name in the dropdown
                        option.textContent = model.name;
                        ollamaModelSelect.appendChild(option);
                        validModelsFound++;
                    } else {
                        console.warn("Skipping invalid model entry from server:", model);
                    }
                });
            } else {
                console.warn("No valid 'models' array found in server response:", data);
            }

            if (validModelsFound > 0) {
                ollamaStatusText.textContent = `Found ${validModelsFound} model(s). Select one.`;
                const savedOllamaModel = localStorage.getItem(OLLAMA_SELECTED_MODEL);
                if (savedOllamaModel) {
                    const exists = Array.from(ollamaModelSelect.options).some(opt => opt.value === savedOllamaModel);
                    if (exists) {
                        ollamaModelSelect.value = savedOllamaModel;
                    } else {
                        localStorage.removeItem(OLLAMA_SELECTED_MODEL);
                    }
                }
            } else {
                ollamaModelSelect.innerHTML = '<option value="">No models found</option>';
                ollamaStatusText.textContent = 'No Ollama models found. Ensure Ollama is running and has models installed.';
            }
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            ollamaModelSelect.innerHTML = '<option value="">Error fetching</option>';
            ollamaStatusText.textContent = `Error: ${error.message}. Make sure Ollama is running.`;
        }
    }

    if (refreshOllamaModelsButton) {
        refreshOllamaModelsButton.addEventListener('click', fetchOllamaModels);
    }

    function showModelsModal() {
        const activeProvider = localStorage.getItem(ACTIVE_MODEL_PROVIDER) || 'gemini';
        
        modelTabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeProvider);
        });
        modelTabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${activeProvider}-tab-content`);
        });
         if (geminiApiKeyContainer) {
            geminiApiKeyContainer.style.display = activeProvider === 'gemini' ? 'flex' : 'none';
        }

        const savedApiKey = localStorage.getItem(GEMINI_API_KEY) || '';
        const savedGeminiModel = localStorage.getItem(GEMINI_MODEL) || 'gemini-1.5-flash';
        geminiApiKeyInput.value = savedApiKey;
        geminiModelSelect.value = savedGeminiModel;

        if (activeProvider === 'ollama' || document.querySelector('.models-modal-tab-button[data-tab="ollama"].active')) {
            fetchOllamaModels(); 
        }
        
        modelsModalBackdrop.style.display = 'block';
        modelsModalDialog.style.display = 'flex';
        document.body.classList.add('modal-open-blur');
    }

    function hideModelsModal() {
        if (modelsModalBackdrop) modelsModalBackdrop.style.display = 'none';
        if (modelsModalDialog) modelsModalDialog.style.display = 'none';
        document.body.classList.remove('modal-open-blur');
    }

    async function saveModelSettings() {
        const activeTabButton = document.querySelector('.models-modal-tab-button.active');
        if (!activeTabButton) {
            console.error("No active model tab found");
            return;
        }
        const activeProvider = activeTabButton.dataset.tab;

        // Function to show an inline error message
        function showModelError(message) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'modal-error-message';
            errorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;
            
            // Remove any existing error
            const existingError = modelsModalDialog.querySelector('.modal-error-message');
            if (existingError) {
                existingError.remove();
            }
            
            // Add to the modal before the actions
            const actionsDiv = modelsModalDialog.querySelector('.models-modal-actions');
            modelsModalDialog.insertBefore(errorMsg, actionsDiv);
            
            // Remove after 4 seconds
            setTimeout(() => {
                if (errorMsg.parentNode) {
                    errorMsg.remove();
                }
            }, 4000);
        }

        if (activeProvider === 'gemini') {
            const apiKey = geminiApiKeyInput.value.trim();
            const modelName = geminiModelSelect.value;
            
            if (!apiKey) {
                showModelError("Gemini API key cannot be empty");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        api_key: apiKey,
                        model_name: modelName,
                        provider: 'gemini'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Gemini settings');
                }
                
                localStorage.setItem(GEMINI_API_KEY, apiKey);
                localStorage.setItem(GEMINI_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'gemini');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show notification instead of chat message
                const modelDisplayName = getModelDisplayName(modelName, 'gemini');
                notificationSystem.show(`Model updated to ${modelDisplayName}`, 'success');

            } catch (error) {
                console.error('Error updating Gemini settings:', error);
                showModelError(error.message);
            }

        } else if (activeProvider === 'ollama') {
            const modelName = ollamaModelSelect.value;
            if (!modelName) {
                showModelError("Please select an Ollama model");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model_name: modelName,
                        provider: 'ollama'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Ollama settings');
                }
                
                localStorage.setItem(OLLAMA_SELECTED_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'ollama');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show notification instead of chat message
                const modelDisplayName = getModelDisplayName(modelName, 'ollama');
                notificationSystem.show(`Model updated to ${modelDisplayName}`, 'success');

            } catch (error) {
                console.error('Error updating Ollama settings:', error);
                showModelError(error.message);
            }
        }
    }

    // Toggle API key visibility
    if (toggleApiVisibilityButton) {
        toggleApiVisibilityButton.addEventListener('click', function() {
            const icon = toggleApiVisibilityButton.querySelector('i');
            
            if (geminiApiKeyInput.type === 'password') {
                geminiApiKeyInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                geminiApiKeyInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Event listeners for Models Modal
    if (settingsModelsItem) {
        settingsModelsItem.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            hideSettingsMenus();
            showModelsModal();
        });
    }

    if (modelsModalSaveButton) {
        modelsModalSaveButton.addEventListener('click', saveModelSettings);
    }

    if (modelsModalCancelButton) {
        modelsModalCancelButton.addEventListener('click', hideModelsModal);
    }

    if (modelsModalBackdrop) {
        modelsModalBackdrop.addEventListener('click', hideModelsModal);
    }

    // Models Modal Tab Logic
    modelTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            modelTabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            const targetTab = button.dataset.tab;
            modelTabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${targetTab}-tab-content`) {
                    content.classList.add('active');
                }
            });

            if (geminiApiKeyContainer) {
                geminiApiKeyContainer.style.display = targetTab === 'gemini' ? 'flex' : 'none';
            }

            if (targetTab === 'ollama') {
                fetchOllamaModels();
            }
        });
    });

    // Rename modal event listeners
    if (renameModalSaveButton) {
        renameModalSaveButton.addEventListener('click', processRename);
    }
    if (renameModalCancelButton) {
        renameModalCancelButton.addEventListener('click', hideRenameModal);
    }
    if (renameModalBackdrop) {
        renameModalBackdrop.addEventListener('click', hideRenameModal);
    }
    if (renameModalInput) {
        renameModalInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                processRename();
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (renameModalDialog.style.display === 'flex') {
                hideRenameModal();
            }
            if (modelsModalDialog.style.display === 'flex') {
                hideModelsModal();
            }
            if (advancedModalDialog.style.display === 'flex') {
                hideAdvancedModal();
            }
        }
    });

    // Initial setup on page load
    ensureGlobalOptionsMenu(); 
    loadAndApplyInitialTheme();

    // Set initial model display
    if (typeof currentProvider !== 'undefined' && typeof currentModel !== 'undefined') {
        localStorage.setItem(ACTIVE_MODEL_PROVIDER, currentProvider);
        if (currentProvider === 'gemini') {
            localStorage.setItem(GEMINI_MODEL, currentModel);
        } else if (currentProvider === 'ollama') {
            localStorage.setItem(OLLAMA_SELECTED_MODEL, currentModel);
        }
        
        const displayName = getModelDisplayName(currentModel, currentProvider);
        if (aiModelDisplay) {
            aiModelDisplay.textContent = `AI Powered by ${displayName}`;
        }
    } else {
        updateChatHeaderModelText();
    }

    currentChats = typeof initialChats !== 'undefined' ? initialChats : [];
    currentActiveThreadId = typeof initialActiveThreadId !== 'undefined' ? initialActiveThreadId : null;

    if (currentActiveThreadId === null && currentChats.length === 0) { 
        console.log("Initial load: No real chats, activating placeholder.");
        currentActiveThreadId = TEMP_NEW_CHAT_ID;
        clearMessagesUI();
    }

    renderSidebar(currentChats, currentActiveThreadId);

    if (currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
        console.log("Initial load: Attempting to load real active chat:", currentActiveThreadId);
        handleSwitchChat(currentActiveThreadId); 
    } else if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
        console.log("Initial load: Placeholder chat is active.");
    } else if (!currentActiveThreadId && currentChats.length > 0) {
        console.log("Initial load: Has real chats, activating the first one.");
        currentActiveThreadId = currentChats[0].thread_id;
        handleSwitchChat(currentActiveThreadId);
    }
    
    setTimeout(() => {
        userInput.focus();
    }, 500);

    // Function to show the Advanced Settings modal
    function showAdvancedModal() {
        advancedModalBackdrop.style.display = 'block';
        advancedModalDialog.style.display = 'flex';
        document.body.classList.add('modal-open-blur');
        
        // Ensure the correct tab is active
        advancedTabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === 'database');
        });
        advancedTabContents.forEach(content => {
            content.classList.toggle('active', content.id === 'database-tab-content');
        });
    }

    // Function to hide the Advanced Settings modal
    function hideAdvancedModal() {
        advancedModalBackdrop.style.display = 'none';
        advancedModalDialog.style.display = 'none';
        document.body.classList.remove('modal-open-blur');
    }

    // Function to delete all chats - remove confirmation alert
    async function deleteAllChats() {
        try {
            const response = await fetch('/delete_all_chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete all chats');
            }
            
            const data = await response.json();
            
            // Clear UI state
            currentChats = [];
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            
            // Clear messages UI and show initial greeting
            clearMessagesUI();
            
            // Update sidebar
            renderSidebar([], TEMP_NEW_CHAT_ID);
            
            // Close modal
            hideAdvancedModal();
            
            // Show a temporary success message in the chat
            addMessage("All chat history has been deleted.", false);
            
        } catch (error) {
            console.error('Error deleting all chats:', error);
            // Show error in the chat instead of alert
            addMessage(`Error deleting chats: ${error.message}`, false);
        }
    }

    // Advanced Settings Event Listeners
    if (settingsAdvancedItem) {
        settingsAdvancedItem.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            hideSettingsMenus();
            showAdvancedModal();
        });
    }

    if (advancedModalCloseButton) {
        advancedModalCloseButton.addEventListener('click', hideAdvancedModal);
    }

    if (advancedModalBackdrop) {
        advancedModalBackdrop.addEventListener('click', hideAdvancedModal);
    }

    if (deleteAllChatsButton) {
        deleteAllChatsButton.addEventListener('click', deleteAllChats);
    }

    // Handle Advanced Settings tab switching
    advancedTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all tab buttons
            advancedTabButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');

            const targetTab = button.dataset.tab;
            // Hide all tab contents
            advancedTabContents.forEach(content => {
                content.classList.remove('active');
            });
            // Show selected tab content
            const activeContent = document.getElementById(`${targetTab}-tab-content`);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        });
    });

    // Add notification system
    const notificationSystem = {
        container: null,
        timeout: null,
        
        init() {
            // Create container for notifications if it doesn't exist
            if (!this.container) {
                this.container = document.createElement('div');
                this.container.className = 'notification-container';
                document.body.appendChild(this.container);
            }
        },
        
        show(message, type = 'info') {
            this.init();
            
            // Clear any existing notifications and timeouts
            this.clear();
            
            // Create notification element
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            
            // Set icon based on type
            let icon = 'fa-circle-info';
            if (type === 'success') icon = 'fa-circle-check';
            if (type === 'error') icon = 'fa-circle-exclamation';
            if (type === 'warning') icon = 'fa-triangle-exclamation';
            
            notification.innerHTML = `
                <i class="fa-solid ${icon}"></i>
                <span>${message}</span>
                <button class="notification-close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            
            // Add close button functionality
            const closeBtn = notification.querySelector('.notification-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.clear());
            }
            
            // Add to container
            this.container.appendChild(notification);
            
            // Animation
            setTimeout(() => {
                notification.classList.add('visible');
            }, 10);
            
            // Auto dismiss after 4 seconds
            this.timeout = setTimeout(() => {
                this.clear();
            }, 4000);
        },
        
        clear() {
            if (this.timeout) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            
            if (this.container) {
                const notifications = this.container.querySelectorAll('.notification');
                notifications.forEach(notif => {
                    notif.classList.remove('visible');
                    setTimeout(() => {
                        if (notif.parentNode === this.container) {
                            this.container.removeChild(notif);
                        }
                    }, 300); // Match transition duration
                });
            }
        }
    };
    
    // Function to delete all chats - replace chat message with notification
    async function deleteAllChats() {
        try {
            const response = await fetch('/delete_all_chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete all chats');
            }
            
            // Clear UI state
            currentChats = [];
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            
            // Clear messages UI and show initial greeting
            clearMessagesUI();
            
            // Update sidebar
            renderSidebar([], TEMP_NEW_CHAT_ID);
            
            // Close modal
            hideAdvancedModal();
            
            // Show notification instead of chat message
            notificationSystem.show('All chat history has been deleted', 'success');
            
        } catch (error) {
            console.error('Error deleting all chats:', error);
            notificationSystem.show(`Error: ${error.message}`, 'error');
        }
    }
    
    // Models modal handling - replace alerts with inline notifications and success with notification toast
    async function saveModelSettings() {
        const activeTabButton = document.querySelector('.models-modal-tab-button.active');
        if (!activeTabButton) {
            console.error("No active model tab found");
            return;
        }
        const activeProvider = activeTabButton.dataset.tab;
        
        // Function to show an inline error message
        function showModelError(message) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'modal-error-message';
            errorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;
            
            // Remove any existing error
            const existingError = modelsModalDialog.querySelector('.modal-error-message');
            if (existingError) {
                existingError.remove();
            }
            
            // Add to the modal before the actions
            const actionsDiv = modelsModalDialog.querySelector('.models-modal-actions');
            modelsModalDialog.insertBefore(errorMsg, actionsDiv);
            
            // Remove after 4 seconds
            setTimeout(() => {
                if (errorMsg.parentNode) {
                    errorMsg.remove();
                }
            }, 4000);
        }

        if (activeProvider === 'gemini') {
            const apiKey = geminiApiKeyInput.value.trim();
            const modelName = geminiModelSelect.value;
            
            if (!apiKey) {
                showModelError("Gemini API key cannot be empty");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        api_key: apiKey,
                        model_name: modelName,
                        provider: 'gemini'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Gemini settings');
                }
                
                localStorage.setItem(GEMINI_API_KEY, apiKey);
                localStorage.setItem(GEMINI_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'gemini');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show notification instead of chat message
                const modelDisplayName = getModelDisplayName(modelName, 'gemini');
                notificationSystem.show(`Model updated to ${modelDisplayName}`, 'success');

            } catch (error) {
                console.error('Error updating Gemini settings:', error);
                showModelError(error.message);
            }

        } else if (activeProvider === 'ollama') {
            const modelName = ollamaModelSelect.value;
            if (!modelName) {
                showModelError("Please select an Ollama model");
                return;
            }

            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model_name: modelName,
                        provider: 'ollama'
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to update Ollama settings');
                }
                
                localStorage.setItem(OLLAMA_SELECTED_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'ollama');
                
                updateChatHeaderModelText();
                hideModelsModal();
                
                // Show notification instead of chat message
                const modelDisplayName = getModelDisplayName(modelName, 'ollama');
                notificationSystem.show(`Model updated to ${modelDisplayName}`, 'success');

            } catch (error) {
                console.error('Error updating Ollama settings:', error);
                showModelError(error.message);
            }
        }
    }
});