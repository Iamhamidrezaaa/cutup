// Background service worker for Cutup extension

// Keep service worker alive
let keepAliveInterval;

function keepAlive() {
  chrome.runtime.getPlatformInfo(() => {
    // This keeps the service worker alive
  });
}

// Install event
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Cutup extension installed');
    // Set default theme
    chrome.storage.local.set({ theme: 'light' });
  }
  
  // Start keep-alive
  keepAliveInterval = setInterval(keepAlive, 20000); // Every 20 seconds
});

// Startup event
chrome.runtime.onStartup.addListener(() => {
  console.log('Cutup extension started');
  keepAliveInterval = setInterval(keepAlive, 20000);
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ url: tabs[0].url });
      }
    });
    return true; // Keep channel open for async response
  }
  
  // Keep service worker alive on any message
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  keepAliveInterval = setInterval(keepAlive, 20000);
});

// Cleanup on shutdown
chrome.runtime.onSuspend.addListener(() => {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
});

