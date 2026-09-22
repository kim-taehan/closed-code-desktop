window.addEventListener('message', function (event) {
  document.getElementById('log').textContent += JSON.stringify(event.data) + '\n'
})
parent.postMessage({ hello: 'board' }, '*')
