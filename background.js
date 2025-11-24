// Background service worker for Cutup extension
// Handles session sync from website

// Single message listener for all message types
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'sync_session') {
    if (message.session) {
      // Save session to extension storage
      chrome.storage.local.set({ cutup_session: message.session }, () => {
        console.log('Background: Session synced from website:', message.session);
        // Storage change will automatically trigger popup listener
      });
    } else {
      // Session was removed (logout)
      chrome.storage.local.remove(['cutup_session'], () => {
        console.log('Background: Session removed (logout)');
        // Storage change will automatically trigger popup listener
      });
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'auth_success' && message.session) {
    chrome.storage.local.set({ cutup_session: message.session }, () => {
      console.log('Background: Session saved from auth:', message.session);
      sendResponse({ success: true });
    });
    return true;
  }
  
  return false;
});
