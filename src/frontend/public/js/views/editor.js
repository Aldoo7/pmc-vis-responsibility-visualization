let editorSelectionTimeout;
let connectionTest = true;

function handleEditorSelection(event, cy) {
  clearTimeout(editorSelectionTimeout);
  if (connectionTest) {
    editorSelectionTimeout = setTimeout(async () => {
      const name = document.getElementById('project-id').innerHTML;
      const content = cy.$('node.s:selected').map((n) => n.data());

      fetch(`http://localhost:3001/${name}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(content),
      }).catch(() => {
        console.warn(
          "failed to reach editor at 3001, won't try again until page reload",
        );
        connectionTest = false;
      });
    }, 200); // if updates are too frequent, this value may be updated.
  }
}

export { handleEditorSelection };
