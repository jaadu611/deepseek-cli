// @ts-nocheck
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function getFileDiff(filePath, oldContent, newContent) {
  const tempOld = filePath + '.old_diff';
  const tempNew = filePath + '.new_diff';
  
  try {
    fs.writeFileSync(tempOld, oldContent, 'utf8');
    fs.writeFileSync(tempNew, newContent, 'utf8');
    const diff = execSync(`diff -u "${tempOld}" "${tempNew}"`, { encoding: 'utf8' });
    return diff.replace(new RegExp(tempOld.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), filePath + ' (old)').replace(new RegExp(tempNew.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), filePath + ' (new)');
  } catch (err) {
    if (err.stdout) {
      return err.stdout.toString().replace(new RegExp(tempOld.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), filePath + ' (old)').replace(new RegExp(tempNew.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), filePath + ' (new)');
    }
    // Fallback: simple line count summary
    return `[Diff unavailable. Old: ${oldContent.split('\n').length} lines, New: ${newContent.split('\n').length} lines]`;
  } finally {
    try { fs.unlinkSync(tempOld); } catch (e) {}
    try { fs.unlinkSync(tempNew); } catch (e) {}
  }
}

module.exports = {
  getFileDiff
};
