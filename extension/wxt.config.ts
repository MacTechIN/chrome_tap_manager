import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Chrome Tap Manager',
    description: '작업마다 창 하나, 이름 하나. 창이 곧 주제가 되고, 검색 한 번으로 그 창을 앞으로.',
    // Fixed extension ID (E12): the public half of keys/chrome-tap-manager.pem (git-ignored,
    // keep a backup). ID = ddhenmblchfpohdkenlkfiopjgciljhm — bridge/ registers this in
    // the native host manifest's allowed_origins. Changing the key changes the ID and
    // orphans chrome.storage.local, so never regenerate it casually.
    // Omitted for store uploads after the first one (STORE=1 pnpm zip): the store rejects a
    // manifest with `key` once the item exists, and signs with its own copy of the key.
    ...(process.env.STORE
      ? {}
      : {
          key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxvoU/UZIM39I6bm6gHjkK1ZnNH9FGCjFlMpoqWHDYQ8sfhTs8GaV1aGD9qsonVr3ERWDBtr3Z0MasCk2I3kMIYzlAiaOOi2miOLN92OBU0pQelY1f+S7OnxmQZrFsEfowfUAcvW8qEGNjR+DrXegPPLkIWz6tmXn8KlEif05KlylcoIsPGnSHmUtDOXL+1/5hTVrUyQ48WnzNf0jfUPhbZcJHuoGW912m07MRv90k3WskjknFx/JIIC10unRKkU7xhJOLQdMm8YhNqMISMTgruM37qP6CenFeeXVL53Dqgab6eNZhygbWa9vaWYZnAyoaN3D1p5xeKw1gR6rotS2xwIDAQAB',
        }),
    // sidePanel.open() and the side_panel manifest key need Chrome 116+.
    minimum_chrome_version: '116',
    // Permission review (E12): tabs = read every window's tab titles/URLs (the whole point),
    // storage = topic names/rules, commands = shortcuts, contextMenus = "주제로 보내기",
    // tabGroups = read-only mirror of Chrome tab groups, sidePanel = topic tree.
    permissions: ['tabs', 'storage', 'commands', 'contextMenus', 'tabGroups', 'sidePanel'],
    // nativeMessaging: Bridge to the desktop app (E10). Optional — requested from the
    // options page only when the user installs the desktop app.
    optional_permissions: ['nativeMessaging'],
    // Address bar: type "t" + space, then a keyword (E07).
    omnibox: { keyword: 't' },
    action: {
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png' },
    },
    // Side panel: topic → sub-group → tab tree (E08). Opened from the popup footer.
    side_panel: { default_path: 'sidepanel.html' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+Space', mac: 'Alt+Space' },
        description: '검색창 열기',
      },
      'send-to-last-topic': {
        suggested_key: { default: 'Ctrl+Shift+M', mac: 'Command+Shift+M' },
        description: '현재 탭을 마지막 사용 주제로 보내기',
      },
    },
  },
});
