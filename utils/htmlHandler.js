const fs = require('fs');
const path = require('path');

function iframeInstance(masterDom, gameHtmlPath, iframeId='gameFrame') {
  let gameHtml = fs.readFileSync(path.resolve(gameHtmlPath), 'utf-8');
  const doc = masterDom.window.document;

  const oldIframe = doc.getElementById(iframeId);
  if (oldIframe) {
      oldIframe.remove();
  }

  const iframe = doc.createElement('iframe');
  iframe.id = iframeId;
  doc.body.appendChild(iframe);

  const mockInjection = `
  <script>
    const memStorage = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k) => memStorage[k] || null,
        setItem: (k, v) => { memStorage[k] = String(v); },
        removeItem: (k) => { delete memStorage[k]; },
        clear: () => { Object.keys(memStorage).forEach(k => delete memStorage[k]); }
      },
      writable: true
    });

    window.AudioContext = class {
      createGain() { return { connect: () => {} }; }
      createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {} }; }
    };
    window.webkitAudioContext = window.AudioContext;
    window.requestAnimationFrame = (cb) => {setTimeout(cb, 0)};
  </script>
  `;

  if (gameHtml.includes('<head>')) {
    gameHtml = gameHtml.replace('<head>', '<head>' + mockInjection);
  } else {
    gameHtml = mockInjection + gameHtml;
  }

  const iframeDoc = iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(gameHtml);
  iframeDoc.close();

  return iframe.contentWindow;
}


module.exports = { iframeInstance };
