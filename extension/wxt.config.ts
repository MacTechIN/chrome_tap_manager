import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Chrome Tap Manager',
    description: '작업마다 창 하나, 이름 하나. 창이 곧 주제가 되고, 검색 한 번으로 그 창을 앞으로.',
    // nativeMessaging: Bridge to the desktop app (E10). Harmless when no host is installed.
    permissions: [
      'tabs',
      'storage',
      'commands',
      'contextMenus',
      'tabGroups',
      'sidePanel',
      'nativeMessaging',
    ],
    // Address bar: type "t" + space, then a keyword (E07).
    omnibox: { keyword: 't' },
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
