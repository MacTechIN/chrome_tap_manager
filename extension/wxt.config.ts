import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Chrome Tap Manager',
    description: '작업마다 창 하나, 이름 하나. 창이 곧 주제가 되고, 검색 한 번으로 그 창을 앞으로.',
    // E01 scope. Later steps add: tabGroups, sidePanel (E08), nativeMessaging (E10), omnibox (E07).
    permissions: ['tabs', 'storage', 'commands', 'contextMenus'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+Space', mac: 'Alt+Space' },
        description: '검색창 열기',
      },
    },
  },
});
