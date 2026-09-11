import { beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants } from '../../src/core/invariants';
import { emptyLiveState, type LiveEvent, type LiveState, reduce } from '../../src/core/liveState';
import { MemoryKV, Repo } from '../../src/core/repo';
import { TopicService } from '../../src/core/topicService';

const T0 = 1_700_000_000_000;

describe('TopicService.adoptWindow', () => {
  let repo: Repo;
  let service: TopicService;
  let state: LiveState;
  let now = T0;
  let seq = 0;

  const emit = async (...events: LiveEvent[]) => {
    for (const e of events) {
      now += 1000;
      state = reduce(state, e);
      await service.apply(e, state);
      expect(checkInvariants(repo.snapshot())).toEqual([]);
    }
  };

  beforeEach(async () => {
    seq = 0;
    now = T0;
    state = emptyLiveState();
    repo = new Repo(new MemoryKV(), { now: () => now, newId: () => `id-${++seq}` });
    await repo.init();
    service = new TopicService({ repo, freshSession: false });
    await emit({
      type: 'init',
      windows: [
        {
          id: 10,
          focused: true,
          tabs: [
            {
              id: 1,
              windowId: 10,
              index: 0,
              url: 'https://x.com/1',
              title: 'X1',
              active: true,
              pinned: false,
            },
          ],
        },
      ],
    });
    await service.rename(repo.findTopicByWindow(10)!.id, 'Saved one');
    await emit(
      { type: 'tab.removed', tabId: 1, windowId: 10, isWindowClosing: true },
      { type: 'window.removed', windowId: 10 },
    );
  });

  it('adopts a window that has no topic yet; later tab events attach to the adopted topic', async () => {
    const topic = repo.listTopics()[0]!;
    expect(topic.status).toBe('saved');

    await service.adoptWindow(topic.id, 50);
    expect(repo.getTopic(topic.id)).toMatchObject({ status: 'open', windowId: 50 });
    expect(repo.listTabs({ topicId: topic.id })).toEqual([]); // closed rows dropped

    await emit(
      { type: 'window.created', window: { id: 50, focused: true } },
      {
        type: 'tab.created',
        tab: {
          id: 9,
          windowId: 50,
          index: 0,
          url: 'https://x.com/1',
          title: 'X1',
          active: true,
          pinned: false,
        },
      },
    );
    expect(repo.listTopics()).toHaveLength(1);
    expect(repo.findTabByChromeId(9)!.topicId).toBe(topic.id);
  });

  it('merges an auto-created topic when the window event raced ahead', async () => {
    const topic = repo.listTopics()[0]!;
    await emit(
      { type: 'window.created', window: { id: 50, focused: true } },
      {
        type: 'tab.created',
        tab: {
          id: 9,
          windowId: 50,
          index: 0,
          url: 'https://x.com/1',
          title: 'X1',
          active: true,
          pinned: false,
        },
      },
    );
    const auto = repo.findTopicByWindow(50)!;
    expect(auto.id).not.toBe(topic.id);

    await service.adoptWindow(topic.id, 50);
    expect(repo.getTopic(auto.id)).toBeUndefined();
    expect(repo.findTopicByWindow(50)!.id).toBe(topic.id);
    expect(repo.findTabByChromeId(9)!.topicId).toBe(topic.id);
    expect(checkInvariants(repo.snapshot())).toEqual([]);
  });

  it('is a no-op for an already-adopted window and rejects a topic open elsewhere', async () => {
    const topic = repo.listTopics()[0]!;
    await service.adoptWindow(topic.id, 50);
    await expect(service.adoptWindow(topic.id, 50)).resolves.toMatchObject({ windowId: 50 });
    await expect(service.adoptWindow(topic.id, 51)).rejects.toMatchObject({
      code: 'topic.notSaved',
    });
    await expect(service.adoptWindow('nope', 52)).rejects.toMatchObject({ code: 'topic.notFound' });
  });
});
