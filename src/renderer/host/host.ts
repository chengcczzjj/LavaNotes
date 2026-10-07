// Invisible page that opens every note window. window.open keeps the notes in
// this page's renderer process instead of starting one process per note.
window.lavaHost.onOpen(({ url, frameName }) => {
  window.open(url, frameName)
})
