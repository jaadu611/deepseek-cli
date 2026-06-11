const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Copy sidebar.html
copyRecursiveSync(
  path.join(__dirname, 'src', 'webview', 'sidebar.html'),
  path.join(__dirname, 'dist', 'src', 'webview', 'sidebar.html')
);

// Copy mcp.json
copyRecursiveSync(
  path.join(__dirname, 'src', 'mcp', 'mcp.json'),
  path.join(__dirname, 'dist', 'src', 'mcp', 'mcp.json')
);

// Copy installed_servers
copyRecursiveSync(
  path.join(__dirname, 'src', 'mcp', 'installed_servers'),
  path.join(__dirname, 'dist', 'src', 'mcp', 'installed_servers')
);

console.log('Static assets copied to dist/ successfully.');
