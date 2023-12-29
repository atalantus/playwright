const fs = require('fs');
const types = require('playwright-core/src/server/types');
const dom = require('playwright-core/src/server/dom');

function patch_driver(path) {
  console.log('Patching driver for ' + path);

  function commentRuntimeEnable(path) {
    let fileText = fs.readFileSync(path, 'utf8');
    const regex = new RegExp('.*Runtime\.enable.*', 'g');
    const matchedRegex = fileText.match(regex);

    if (!matchedRegex || matchedRegex.length === 0) {
      console.warn(`Expected "Runtime.enable" usage in file "${path}" but none were found`);
      return false;
    }

    for (const target of matchedRegex) {
      fileText = fileText.replace(target, '// ' + target);
    }

    fs.writeFileSync(path, fileText);
    return true;
  }

  // comment all occurrences of leaky Runtime.Enable API in chromium server
  const filesToPatch = ['crDevTools.ts', 'crPage.ts', 'crServiceWorker.ts'];
  for (const file of filesToPatch) {
    if (commentRuntimeEnable(path + 'chromium/' + file)) {
      console.log('Successfully patched ' + file);
    }
  }

  // patching execution context
  const frames_path = path + 'frames.js';
  let framesFileText = fs.readFileSync(frames_path, 'utf8');

  framesFileText = '// ------------------------------------------------------------------\n' +
    '// undetected-playwright patch - custom imports\n' +
    'import * as _crExecutionContext from \'./chromium/crExecutionContext\'\n' +
    '// ------------------------------------------------------------------\n' +
    framesFileText;

  const contextWorldFnRegEx = /\s_context\(world:\s*types\.World\s*\)\s*:\s*Promise<dom\.FrameExecutionContext>\s*\{(?:[^}{]+|\{(?:[^}{]+|\{[^}{]*\})*\})*\}/g;
  const contextWorldFnMatches = framesFileText.match(contextWorldFnRegEx);
  const contextWorldFnReplacement = ` async _context(world) {
    // atm ignores world_name
    if (this._isolatedContext == undefined) {
      const worldName = 'utility';
      const result = await this._page._delegate._mainFrameSession._client.send('Page.createIsolatedWorld', {
        frameId: this._id,
        grantUniveralAccess: true,
        worldName: worldName
      });
      const crContext = new _crExecutionContext.CRExecutionContext(this._page._delegate._mainFrameSession._client, {id: result.executionContextId});
      this._isolatedContext = new _dom.FrameExecutionContext(crContext, this, worldName)
    }
    return this._isolatedContext
  }`;

  if (!contextWorldFnMatches || contextWorldFnMatches.length !== 1) {
    console.error(`Expected exactly one match for the "_context(world)" function definition in file "${framesFileText}" but got ${contextWorldFnMatches?.length ?? 0}`);
    return;
  }

  // patch _context(world) function
  framesFileText = framesFileText.replace(contextWorldFnRegEx, contextWorldFnReplacement);

  const onClearLifecycleFnRegEx = /\s_onClearLifecycle\(\)\s*\{/g;
  const onClearLifecycleMatches = framesFileText.match(onClearLifecycleFnRegEx);
  const onClearLifecycleFnReplacement = ` _onClearLifecycle() {
        this._isolatedContext = undefined;
        `;

  if (!onClearLifecycleMatches || onClearLifecycleMatches.length !== 1) {
    console.error(`Expected exactly one match for the "_onClearLifecycle()" function definition in file "${framesFileText}" but got ${onClearLifecycleMatches?.length ?? 0}`);
    return;
  }

  // patch _onClearLifecycle() function
  framesFileText = framesFileText.replace(onClearLifecycleFnRegEx, onClearLifecycleFnReplacement);

  fs.writeFileSync(frames_path, framesFileText);
  console.log('Successfully patched ' + frames_path);

  console.log('Successfully patched all files');
}

patch_driver('../packages/playwright-core/src/server/');
