const QUOTES_URL = "http://8.154.33.143/ma/dashboard/realtime-quotes"

function go() {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.getCurrent) {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null && chrome.tabs.update) {
        chrome.tabs.update(tab.id, { url: QUOTES_URL })
        return
      }
      location.replace(QUOTES_URL)
    })
    return
  }
  location.replace(QUOTES_URL)
}

go()
