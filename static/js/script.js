document.addEventListener('DOMContentLoaded', function() {
    const messagesContainer = document.getElementById('messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const emojiElement = document.querySelector('.emoji');
    const newChatButton = document.getElementById('new-chat-button');
    const chatListUL = document.querySelector('.chat-list');
    const aiModelDisplay = document.getElementById('ai-model-display'); // Get the new element

    let currentChats = []; // Holds real chats from the server
    let currentActiveThreadId = null; // Can be a real ID, TEMP_NEW_CHAT_ID, or null
    
    const TEMP_NEW_CHAT_ID = 'temp-new-chat-placeholder';
    const NEW_CHAT_PLACEHOLDER_ICON_JS = '📝'; // Should match backend's NEW_CHAT_PLACEHOLDER_ICON

    let globalOptionsMenu = null; // Will hold the single, global options menu
    let currentOpenMenuChatContext = null; // To store { thread_id, title } for the open menu

    // Rename Modal Elements
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

    let themeSubmenuTimeout; // To manage hover-out delay

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

    // Local storage keys for models
    const GEMINI_API_KEY = 'geminiApiKey';
    const GEMINI_MODEL = 'geminiModel';
    const OLLAMA_SELECTED_MODEL = 'ollamaSelectedModel';
    const ACTIVE_MODEL_PROVIDER = 'activeModelProvider'; // 'gemini' or 'ollama'

    // --- Helper function to format model name for display ---
    function getModelDisplayName(modelId, provider) {
        if (!modelId) {
            return provider === 'ollama' ? "Default Ollama Model" : "Gemini 1.5 Flash";
        }
        if (provider === 'ollama') {
            // Ollama models might have tags like :latest, remove them for display
            return modelId.split(':')[0]
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        // Gemini
        return modelId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    // --- Function to update chat header model text ---
    function updateChatHeaderModelText() {
        const activeProvider = localStorage.getItem(ACTIVE_MODEL_PROVIDER) || 'gemini';
        let modelId;
        if (activeProvider === 'ollama') {
            modelId = localStorage.getItem(OLLAMA_SELECTED_MODEL);
        } else {
            modelId = localStorage.getItem(GEMINI_MODEL) || 'gemini-1.5-flash';
        }
        
        if (aiModelDisplay) {
            const displayName = getModelDisplayName(modelId, activeProvider);
            aiModelDisplay.textContent = `AI Powered by ${displayName}`;
        }
    }

    // --- Theme Management ---
    const THEME_KEY = 'selectedTheme';

    function applyTheme(theme) {
        if (theme === 'system') {
            document.documentElement.removeAttribute('data-theme'); // Let CSS media query take over if defined
            localStorage.removeItem(THEME_KEY);
            // Re-evaluate system preference immediately
            const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (systemPrefersDark) {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                // If your base CSS is light theme, removing data-theme works.
                // Or, explicitly set to light:
                document.documentElement.setAttribute('data-theme', 'light');
            }
        } else {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem(THEME_KEY, theme);
        }
        console.log(`Theme applied: ${theme}, data-theme: ${document.documentElement.getAttribute('data-theme')}`);
    }

    function loadAndApplyInitialTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
            applyTheme(savedTheme);
        } else { // No saved theme or 'system' was saved (though we remove 'system' key now)
            applyTheme('system'); // Default to system if nothing specific is stored
        }
    }
    
    // Listen for changes in system color scheme preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        const currentThemePreference = localStorage.getItem(THEME_KEY);
        if (!currentThemePreference || currentThemePreference === 'system') { // Only if user wants system default
            applyTheme('system'); // Re-apply system theme
        }
    });

    // --- End Theme Management ---


    // Function to create the global options menu element if it doesn't exist
    function ensureGlobalOptionsMenu() {
        if (globalOptionsMenu) return;

        globalOptionsMenu = document.createElement('div');
        globalOptionsMenu.className = 'chat-item-options-menu'; // Use existing class for styling
        // Basic structure, specific actions will be updated on show
        globalOptionsMenu.innerHTML = `
            <a href="#" data-action="pin_toggle"><i class="fa-solid fa-thumbtack"></i> Pin</a>
            <a href="#" data-action="rename"><i class="fa-solid fa-pen-to-square"></i> Rename</a>
            <a href="#" data-action="delete"><i class="fa-solid fa-trash-can"></i> Delete</a>
        `;
        document.body.appendChild(globalOptionsMenu);

        // Add event listeners to the menu items ONCE
        globalOptionsMenu.querySelectorAll('a').forEach(optionLink => {
            optionLink.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const action = event.currentTarget.dataset.action;
                
                if (!currentOpenMenuChatContext) {
                    console.error("No chat context for menu action.");
                    hideGlobalOptionsMenu();
                    return;
                }
                
                const { thread_id, title, is_pinned } = currentOpenMenuChatContext; // Add is_pinned
                console.log(`Action: ${action}, Chat ID: ${thread_id}, Title: ${title}, Pinned: ${is_pinned}`);
                
                // Placeholder for actual functionality
                if (action === 'delete') {
                    handleDeleteChat(thread_id, title);
                } else if (action === 'rename') {
                    handleRenameChat(thread_id, title);
                } else if (action === 'pin_toggle') { // Changed from 'pin' to 'pin_toggle'
                    handleTogglePinChat(thread_id);
                }
                hideGlobalOptionsMenu();
            });
        });
    }

    // Function to handle renaming a chat - This will now just show the modal
    async function handleRenameChat(thread_id, current_title) {
        // const newTitle = window.prompt("Enter new name for the chat:", current_title); // Replaced by modal
        renameContext = { thread_id, current_title };
        renameModalInput.value = current_title;
        renameModalInput.placeholder = current_title || "Enter new chat name";
        
        renameModalBackdrop.style.display = 'block';
        renameModalDialog.style.display = 'flex'; // Use flex as defined in CSS
        document.body.classList.add('modal-open-blur');
        renameModalInput.focus();
        renameModalInput.select();
    }

    function hideRenameModal() {
        renameModalBackdrop.style.display = 'none';
        renameModalDialog.style.display = 'none';
        document.body.classList.remove('modal-open-blur');
        renameModalInput.value = ''; // Clear input
        renameContext = { thread_id: null, current_title: '' }; // Reset context
    }

    async function processRename() {
        const newTitle = renameModalInput.value.trim();
        const { thread_id, current_title } = renameContext;

        if (newTitle && newTitle !== "" && newTitle !== current_title) {
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
                // addMessage(`Chat renamed to "${newTitle}"`, false); // Optional UI feedback
            } catch (error) {
                console.error('Error renaming chat:', error);
                addMessage(`Error: ${error.message}`, false);
            } finally {
                hideRenameModal();
            }
        } else if (newTitle === current_title) {
            hideRenameModal(); // No change, just close
        } else if (!newTitle) {
            // Optionally show an error in the modal or just don't close
            alert("Chat name cannot be empty.");
        }
    }

    // Event listeners for Rename Modal
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
                event.preventDefault(); // Prevent form submission if it were in a form
                processRename();
            }
        });
    }
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && renameModalDialog.style.display === 'flex') {
            hideRenameModal();
        }
    });

    // --- Settings Menu Logic ---
    function positionMenuAboveButton(menuElement, buttonElement) {
        const buttonRect = buttonElement.getBoundingClientRect();
        menuElement.style.bottom = (window.innerHeight - buttonRect.top + 10) + 'px'; // 10px gap above button
        menuElement.style.left = buttonRect.left + 'px';
        menuElement.style.width = buttonRect.width + 'px'; // Match button width
    }

    function positionSubmenuToSide(submenuElement, parentItemElement) {
        const parentRect = parentItemElement.getBoundingClientRect();
        submenuElement.style.top = parentRect.top + 'px';
        submenuElement.style.left = parentRect.right + 5 + 'px'; // 5px gap to the right
    }

    function hideSettingsMenus() {
        if (settingsMenu) settingsMenu.style.display = 'none';
        if (themeSubmenu) themeSubmenu.style.display = 'none';
    }

    if (settingsButton && settingsMenu) {
        settingsButton.addEventListener('click', function(event) {
            event.stopPropagation();
            const isMenuVisible = settingsMenu.style.display === 'block';
            hideGlobalOptionsMenu(); // Hide chat options if open
            // hideSettingsMenus(); // Hide any open settings submenus first - Now handled differently for hover

            if (!isMenuVisible) {
                // If theme submenu was open from a previous hover, ensure it's closed before reopening main.
                if (themeSubmenu) themeSubmenu.style.display = 'none';
                settingsMenu.style.display = 'block';
                positionMenuAboveButton(settingsMenu, settingsButton);
            } else {
                hideSettingsMenus(); // If menu is visible, clicking button closes all
            }
        });
    }

    if (settingsThemeItem && themeSubmenu) {
        settingsThemeItem.addEventListener('mouseenter', function(event) {
            clearTimeout(themeSubmenuTimeout);
            // Hide other submenus if any in future
            themeSubmenu.style.display = 'block';
            positionSubmenuToSide(themeSubmenu, settingsThemeItem);
        });

        settingsThemeItem.addEventListener('mouseleave', function(event) {
            themeSubmenuTimeout = setTimeout(() => {
                themeSubmenu.style.display = 'none';
            }, 200); // Small delay to allow moving mouse to submenu
        });

        themeSubmenu.addEventListener('mouseenter', function(event) {
            clearTimeout(themeSubmenuTimeout); // User entered submenu, cancel hide
        });

        themeSubmenu.addEventListener('mouseleave', function(event) {
            themeSubmenu.style.display = 'none'; // Hide when mouse leaves submenu
        });
    }

    // Placeholder for settings actions
    if (settingsMenu) {
        settingsMenu.querySelectorAll('.settings-menu-item').forEach(item => {
            item.addEventListener('click', function(event) {
                const action = this.dataset.action;
                if (action && action !== 'theme' && action !== 'models') { // Added models to exclusion list
                    event.preventDefault();
                    console.log(`Settings action: ${action}`);
                    // Implement actual action (e.g., show info page/modal)
                    alert(`Action: ${action} - Not implemented yet.`);
                    hideSettingsMenus();
                }
                // For 'theme' and 'models' items, click is handled separately
            });
        });
    }
    
    if (themeSubmenu) {
        themeSubmenu.querySelectorAll('.settings-menu-item[data-theme]').forEach(item => {
            item.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                const themeValue = this.dataset.theme;
                applyTheme(themeValue); // Use the new applyTheme function
                // console.log(`Theme selected: ${themeValue}`); // Kept for debugging
                // alert(`Theme: ${themeValue} - Implemented.`); // Optional: remove alert
                hideSettingsMenus();
            });
        });
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
            // currentActiveThreadId should not change on pin/unpin, but good to sync if server sends it
            if (data.active_thread_id !== undefined) {
                currentActiveThreadId = data.active_thread_id;
            }
            renderSidebar(currentChats, currentActiveThreadId);
            // addMessage(`Chat pin status toggled.`, false); // Optional UI feedback
        } catch (error) {
            console.error('Error toggling pin status:', error);
            addMessage(`Error: ${error.message}`, false);
        }
    }

    // Function to handle deleting a chat
    async function handleDeleteChat(thread_id, title) {
        // if (window.confirm(`Are you sure you want to delete the chat "${title}"? This action cannot be undone.`)) { // REMOVED CONFIRMATION
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
                currentActiveThreadId = data.active_thread_id; // This could be null if no chats left

                renderSidebar(currentChats, currentActiveThreadId);

                if (wasActive) {
                    if (currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                        // A new real chat became active
                        handleSwitchChat(currentActiveThreadId);
                    } else {
                        // No real chats left, or server explicitly set active to null, switch to placeholder
                        handleSwitchChat(TEMP_NEW_CHAT_ID);
                    }
                }
                // If deleted chat was not active, sidebar is updated, no need to switch view.

            } catch (error) {
                console.error('Error deleting chat:', error);
                addMessage(`Error: ${error.message}`, false);
            }
        // } // REMOVED CONFIRMATION
    }


    // Function to show the global options menu, positioned relative to the button
    function showGlobalOptionsMenu(chatContext, buttonElement) { // chatContext now includes is_pinned
        ensureGlobalOptionsMenu(); // Make sure the menu element exists

        currentOpenMenuChatContext = chatContext; // Store context for action handlers

        // Update Pin/Unpin link text and action
        const pinToggleLink = globalOptionsMenu.querySelector('a[data-action="pin_toggle"]');
        if (pinToggleLink) {
            if (chatContext.is_pinned) {
                pinToggleLink.innerHTML = `<i class="fa-solid fa-thumbtack"></i> Unpin`; // Or a different icon for unpin
            } else {
                pinToggleLink.innerHTML = `<i class="fa-solid fa-thumbtack"></i> Pin`;
            }
        }


        const rect = buttonElement.getBoundingClientRect();
        
        // Position to the right of the button, vertically centered
        let top = rect.top + window.scrollY + (rect.height / 2) - (globalOptionsMenu.offsetHeight / 2);
        let left = rect.right + window.scrollX + 5; // 5px gap from button's right

        // Boundary checks (simple version, can be more sophisticated)
        if (left + globalOptionsMenu.offsetWidth > window.innerWidth) {
            left = rect.left + window.scrollX - globalOptionsMenu.offsetWidth - 5; // Show on left if not enough space on right
        }
        if (top + globalOptionsMenu.offsetHeight > window.innerHeight) {
            top = window.innerHeight - globalOptionsMenu.offsetHeight - 5 - window.scrollY; // Adjust if too low
        }
        if (top < window.scrollY) {
            top = window.scrollY + 5; // Adjust if too high
        }


        globalOptionsMenu.style.top = `${top}px`;
        globalOptionsMenu.style.left = `${left}px`;
        globalOptionsMenu.classList.add('visible');
    }

    // Function to hide the global options menu
    function hideGlobalOptionsMenu() {
        if (globalOptionsMenu) {
            globalOptionsMenu.classList.remove('visible');
        }
        currentOpenMenuChatContext = null;
    }

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
    function renderSidebar(chatsFromServer, activeThreadIdToSet) {
        chatListUL.innerHTML = '';
        currentChats = chatsFromServer; // Update global list of real chats from server
        currentActiveThreadId = activeThreadIdToSet; // Update global active ID

        // If the active ID is the placeholder, create and prepend its list item
        if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
            const tempListItem = document.createElement('li');
            tempListItem.className = 'chat-list-item active'; // Placeholder is active
            tempListItem.dataset.threadId = TEMP_NEW_CHAT_ID;
            tempListItem.innerHTML = `
                <span class="chat-item-icon">${NEW_CHAT_PLACEHOLDER_ICON_JS}</span>
                <span class="chat-item-text">New Conversation</span>
                <span class="chat-item-time">Now</span>
                <div class="chat-item-options-button" style="display:none;">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </div>`; // Options disabled for placeholder
            tempListItem.addEventListener('click', () => {
                if (currentActiveThreadId !== TEMP_NEW_CHAT_ID) { // Only switch if not already on it
                    handleSwitchChat(TEMP_NEW_CHAT_ID);
                } else {
                    userInput.focus(); // Already on it, just focus input
                }
            });
            chatListUL.appendChild(tempListItem);
        }

        // Render real chats from the server
        currentChats.forEach(chat => {
            const listItem = document.createElement('li');
            listItem.className = 'chat-list-item';
            listItem.dataset.threadId = chat.thread_id;

            // A real chat is active if its ID matches currentActiveThreadId AND currentActiveThreadId is NOT the temp ID
            if (chat.thread_id === currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                listItem.classList.add('active');
            }

            if (chat.is_pinned) { // Add 'pinned' class if chat is pinned
                listItem.classList.add('pinned');
            }

            // If the chat is active (and not the placeholder), don't show "Active" text. Show chat.time if available, otherwise empty.
            // For non-active chats, show chat.time or empty.
            let timeDisplay = chat.time || ''; // Default to chat.time or empty string
            if (chat.thread_id === currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
                // If it's the active real chat, ensure timeDisplay is just chat.time or empty, not "Active"
                timeDisplay = chat.time || ''; 
            }

            // Reconstruct full innerHTML for real chats, including options button
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
                    // Pass is_pinned to chatContext
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
            // Check if the click was outside the menu AND not on any options button
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
            // Check if the click is outside the main settings menu AND the settings button
            if (!settingsMenu.contains(event.target) && event.target !== settingsButton && !settingsButton.contains(event.target)) {
                // Also check if the click is outside the theme submenu if it's open
                if (themeSubmenu && themeSubmenu.style.display === 'block' && themeSubmenu.contains(event.target)) {
                    // Click was inside the theme submenu, do nothing here for the main menu
                } else {
                    hideSettingsMenus();
                }
            }
        }
        // This part of the logic for themeSubmenu might be redundant if hideSettingsMenus() handles all,
        // but kept for safety in case of complex interactions.
        // The primary closing mechanism for themeSubmenu is now mouseleave.
        // This global click ensures if user clicks far away, it still closes.
        if (themeSubmenu && themeSubmenu.style.display === 'block') {
            if (!themeSubmenu.contains(event.target) && event.target !== settingsThemeItem && !settingsThemeItem.contains(event.target)) {
                 themeSubmenu.style.display = 'none';
                 // If the main menu is also open and the click was outside it, it should also close.
                 // The above block for settingsMenu handles closing the main menu.
            }
        }
    });

    // store input history per thread
    const inputHistories = {};
    let historyIndex = 0;

    // Function to handle switching chats
    async function handleSwitchChat(threadId) {
        console.log(`handleSwitchChat called for threadId: ${threadId}. Current active global: ${currentActiveThreadId}`);

        if (threadId === TEMP_NEW_CHAT_ID) {
            // Switching to the placeholder new chat
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID && messagesContainer.querySelector('.message')) {
                userInput.focus(); // Already on it and has messages (e.g. initial greeting)
                return;
            }
            clearMessagesUI();
            displayInitialAIMessage();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID); // currentChats are the real ones
            userInput.focus();
            return;
        }

        // Logic for switching to a REAL chat ID
        const hasMessages = messagesContainer.querySelector('.message') !== null;
        // If switching to a real chat that is already active and populated, do nothing.
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
            
            currentActiveThreadId = data.active_thread_id; // Update global state
            console.log(`handleSwitchChat: currentActiveThreadId updated to: ${currentActiveThreadId}`);

            clearMessagesUI();
            data.messages.forEach(msg => {
                addMessage(msg.content, msg.type === 'human');
            });

            // This specific check for "New Conversation" title might be less relevant here
            // as the placeholder handles the initial greeting.
            // However, if a real chat somehow has 0 messages and is named "New Conversation", it could apply.
            if (data.messages.length === 0 && 
                data.chats && data.chats.length > 0) {
                const switchedToChat = data.chats.find(c => c.thread_id === threadId);
                if (switchedToChat && switchedToChat.title === 'New Conversation') {
                    console.log("handleSwitchChat: Switched to a real chat titled 'New Conversation' with no messages. Displaying initial greeting.");
                    displayInitialAIMessage(); 
                }
            }
            
            renderSidebar(data.chats, data.active_thread_id || threadId); // Re-render sidebar to reflect new order and active state

            // build input history from all past human messages in this conversation
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
            
            let payloadThreadId = currentActiveThreadId;
            let isPlaceholderChat = false;
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
                payloadThreadId = null; // Signal to backend to create a new chat
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
                    addMessage(data.response, false);
                }
                // If a new chat was created from placeholder, server returns 'newly_created_thread_id'
                if (isPlaceholderChat && data.newly_created_thread_id) {
                    currentActiveThreadId = data.newly_created_thread_id; // Update to the real ID
                    currentChats = data.chats; // Update local cache of real chats
                    renderSidebar(currentChats, currentActiveThreadId);
                } else if (data.chats && data.active_thread_id) { // Existing chat, title/icon might have updated
                    currentActiveThreadId = data.active_thread_id;
                    currentChats = data.chats; // Update local cache
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
            // record into history
            if (!inputHistories[currentActiveThreadId]) inputHistories[currentActiveThreadId] = [];
            inputHistories[currentActiveThreadId].push(message);
            historyIndex = inputHistories[currentActiveThreadId].length;

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
            // No fetch to /new_chat
            console.log("New Chat button clicked. Current active: ", currentActiveThreadId);
            
            // If already on the placeholder and it's empty or just has the greeting, do little.
            // If on a real chat, or placeholder has user text (not possible with current send logic), switch.
            if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
                 // If messages exist beyond initial greeting, clear them.
                const messages = messagesContainer.querySelectorAll('.message');
                if (messages.length > 0 && messages[0].innerText.includes("How can I help you today?")) {
                    // Potentially more than just the greeting, or user wants a "fresh" new chat.
                } else if (messages.length === 0) {
                    // no messages, display greeting
                } else {
                    // some other messages, clear and display greeting
                }
                // Simplified: always clear and show greeting for a "fresh" placeholder experience
            }

            clearMessagesUI();
            displayInitialAIMessage();
            currentActiveThreadId = TEMP_NEW_CHAT_ID;
            renderSidebar(currentChats, TEMP_NEW_CHAT_ID); // currentChats are the real ones from last server sync

            // reset history for placeholder
            if (!inputHistories[TEMP_NEW_CHAT_ID]) inputHistories[TEMP_NEW_CHAT_ID] = [];
            historyIndex = inputHistories[TEMP_NEW_CHAT_ID].length;
            userInput.focus();
        });
    }

    // Initial setup on page load
    ensureGlobalOptionsMenu(); 
    loadAndApplyInitialTheme(); // Load and apply theme first

    // Load and apply initial model display text
    updateChatHeaderModelText(); // This will now read from localStorage for provider and model

    currentChats = typeof initialChats !== 'undefined' ? initialChats : []; // Real chats from server
    currentActiveThreadId = typeof initialActiveThreadId !== 'undefined' ? initialActiveThreadId : null; // Real active ID or null

    if (currentActiveThreadId === null && currentChats.length === 0) { 
        // No real chats and no active one from server (e.g., first ever load and DB is empty)
        console.log("Initial load: No real chats, activating placeholder.");
        currentActiveThreadId = TEMP_NEW_CHAT_ID; // Activate placeholder
        clearMessagesUI(); // Ensure clean slate
        displayInitialAIMessage(); // Show greeting for the placeholder
    }

    renderSidebar(currentChats, currentActiveThreadId);

    if (currentActiveThreadId && currentActiveThreadId !== TEMP_NEW_CHAT_ID) {
        // If there's a real active chat, load its messages.
        console.log("Initial load: Attempting to load real active chat:", currentActiveThreadId);
        handleSwitchChat(currentActiveThreadId); 
    } else if (currentActiveThreadId === TEMP_NEW_CHAT_ID) {
        // Placeholder is active, greeting already shown by above logic or by New Chat button.
        console.log("Initial load: Placeholder chat is active.");
    } else if (!currentActiveThreadId && currentChats.length > 0) {
        // Has real chats, but none specifically marked active by server (should be one)
        // Default to the first real chat.
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

            // Show/hide API key for Gemini
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
            const rawResponseText = await response.text(); // Get raw text for debugging
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
            
            const data = JSON.parse(rawResponseText); // Parse JSON after checking response.ok
            console.log("Parsed data from /get_ollama_models:", data);
            
            ollamaModelSelect.innerHTML = ''; // Clear existing options
            
            let validModelsFound = 0;
            if (data && data.models && Array.isArray(data.models) && data.models.length > 0) {
                data.models.forEach(model => {
                    if (model && typeof model.name === 'string' && model.name.trim() !== '') { // Ensure model and model.name are valid
                        const option = document.createElement('option');
                        option.value = model.name;
                        option.textContent = getModelDisplayName(model.name, 'ollama'); 
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
                    // Ensure the saved model is still in the list before setting it
                    const exists = Array.from(ollamaModelSelect.options).some(opt => opt.value === savedOllamaModel);
                    if (exists) {
                        ollamaModelSelect.value = savedOllamaModel;
                    } else {
                        localStorage.removeItem(OLLAMA_SELECTED_MODEL); // Clean up if model no longer exists
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

    // --- Models Modal Functions ---
    function showModelsModal() {
        const activeProvider = localStorage.getItem(ACTIVE_MODEL_PROVIDER) || 'gemini';
        
        // Activate the correct tab
        modelTabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === activeProvider);
        });
        modelTabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${activeProvider}-tab-content`);
        });
         if (geminiApiKeyContainer) {
            geminiApiKeyContainer.style.display = activeProvider === 'gemini' ? 'flex' : 'none';
        }


        // Load Gemini settings
        const savedApiKey = localStorage.getItem(GEMINI_API_KEY) || '';
        const savedGeminiModel = localStorage.getItem(GEMINI_MODEL) || 'gemini-1.5-flash';
        geminiApiKeyInput.value = savedApiKey;
        geminiModelSelect.value = savedGeminiModel;

        // Load/Fetch Ollama settings
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

        if (activeProvider === 'gemini') {
            const apiKey = geminiApiKeyInput.value.trim();
            const modelName = geminiModelSelect.value;
            
            if (!apiKey) {
                alert("Gemini API key cannot be empty.");
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
                    const errData = await response.json();
                    throw new Error(errData.error || 'Failed to update Gemini model settings.');
                }
                
                localStorage.setItem(GEMINI_API_KEY, apiKey);
                localStorage.setItem(GEMINI_MODEL, modelName);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'gemini');
                
                updateChatHeaderModelText();
                addMessage(`Gemini model settings updated. Now using ${getModelDisplayName(modelName, 'gemini')}.`, false);
                hideModelsModal();

            } catch (error) {
                console.error('Error saving Gemini model settings:', error);
                alert(`Error: ${error.message}`);
            }

        } else if (activeProvider === 'ollama') {
            const selectedOllamaModel = ollamaModelSelect.value;
            if (!selectedOllamaModel || ollamaModelSelect.selectedOptions.length === 0 || ollamaModelSelect.selectedOptions[0].text === "Fetching models..." || ollamaModelSelect.selectedOptions[0].text === "No models found" || ollamaModelSelect.selectedOptions[0].text === "Error fetching") {
                alert("Please select a valid Ollama model or ensure models are loaded.");
                return;
            }
            
            try {
                const response = await fetch('/update_model_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'ollama',
                        model_name: selectedOllamaModel
                    }),
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'Failed to update Ollama model settings.');
                }
                const data = await response.json(); // Expect a success message

                localStorage.setItem(OLLAMA_SELECTED_MODEL, selectedOllamaModel);
                localStorage.setItem(ACTIVE_MODEL_PROVIDER, 'ollama');
                
                updateChatHeaderModelText();
                addMessage(data.message || `Switched to Ollama model: ${getModelDisplayName(selectedOllamaModel, 'ollama')}.`, false);
                hideModelsModal();

            } catch (error) {
                console.error('Error saving Ollama model settings:', error);
                alert(`Error: ${error.message}`);
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
            hideSettingsMenus(); // Hide settings menu
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
        }
    });
});