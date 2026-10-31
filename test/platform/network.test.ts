import { describe, expect, it, vi } from "vitest";
import { alwaysOnline, netInfoMonitor } from "../../src/platform/network.js";

type State = { isConnected: boolean | null; isInternetReachable?: boolean | null };

function fakeNetInfo() {
  let listener: (state: State) => void = () => {};
  const unsubscribe = vi.fn();
  return {
    addEventListener: (fn: (state: State) => void) => {
      listener = fn;
      return unsubscribe;
    },
    emit: (state: State) => listener(state),
    unsubscribe,
  };
}

describe("alwaysOnline", () => {
  it("reports online and returns a no-op unsubscribe", () => {
    expect(alwaysOnline.isOnline()).toBe(true);
    expect(() => alwaysOnline.subscribe(() => {})()).not.toThrow();
  });
});

describe("netInfoMonitor", () => {
  it.each([
    [{ isConnected: true, isInternetReachable: true }, true],
    [{ isConnected: true, isInternetReachable: null }, true],
    [{ isConnected: true }, true],
    [{ isConnected: null }, true],
    [{ isConnected: false, isInternetReachable: false }, false],
    [{ isConnected: false }, false],
    [{ isConnected: true, isInternetReachable: false }, false],
  ] satisfies [State, boolean][])("maps %o to online=%s", (state, expected) => {
    const netInfo = fakeNetInfo();
    const monitor = netInfoMonitor(netInfo);
    const listener = vi.fn();
    monitor.subscribe(listener);

    netInfo.emit(state);

    expect(listener).toHaveBeenCalledWith(expected);
    expect(monitor.isOnline()).toBe(expected);
  });

  it("assumes online before the first event and forwards unsubscribe", () => {
    const netInfo = fakeNetInfo();
    const monitor = netInfoMonitor(netInfo);

    expect(monitor.isOnline()).toBe(true);
    monitor.subscribe(() => {})();
    expect(netInfo.unsubscribe).toHaveBeenCalledOnce();
  });
});
