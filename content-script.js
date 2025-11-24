// Content script to sync session between website and extension
// This script runs on cutup.shop pages and can access localStorage

(function() {
  'use strict';
  
  // Check if we're on cutup.shop
  if (!window.location.hostname.includes('cutup.shop')) {
    return;
  }
  
  // Function to sync session to extension
  function syncSessionToExtension() {
    const session = localStorage.getItem('cutup_session');
    if (session) {
      // Send message to extension
      chrome.runtime.sendMessage({
        type: 'sync_session',
        session: session
      }).catch(err => {
        // Extension might not be ready, that's okay
        console.log('Could not send session to extension:', err);
      });
    }
  }
  
  // Sync session when it changes
  const originalSetItem = localStorage.setItem;
  const originalRemoveItem = localStorage.removeItem;
  
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, arguments);
    if (key === 'cutup_session') {
      // Small delay to ensure value is set
      setTimeout(syncSessionToExtension, 100);
    }
  };
  
  localStorage.removeItem = function(key) {
    originalRemoveItem.apply(this, arguments);
    if (key === 'cutup_session') {
      // Notify extension that session was removed
      try {
        chrome.runtime.sendMessage({
          type: 'sync_session',
          session: null
        }).catch(err => {
          console.log('Could not notify extension of logout:', err);
        });
      } catch (e) {
        console.log('Could not notify extension of logout:', e);
      }
    }
  };
  
  // Also watch for storage events (in case session is set from another tab)
  window.addEventListener('storage', (e) => {
    if (e.key === 'cutup_session') {
      if (e.newValue) {
        syncSessionToExtension();
      } else {
        // Session was removed
        try {
          chrome.runtime.sendMessage({
            type: 'sync_session',
            session: null
          }).catch(err => {
            console.log('Could not notify extension of logout:', err);
          });
        } catch (e) {
          console.log('Could not notify extension of logout:', e);
        }
      }
    }
  });
  
  // Sync existing session on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(syncSessionToExtension, 500);
    });
  } else {
    setTimeout(syncSessionToExtension, 500);
  }
  
  // Also sync periodically (in case session was set before script loaded)
  setInterval(syncSessionToExtension, 2000);
})();

