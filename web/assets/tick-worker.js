// A steady ~30fps tick that keeps firing when the tab is in the
// background. Page timers and requestAnimationFrame are throttled or
// suspended in hidden tabs, which froze the zoomed-camera canvas the
// moment a guest switched tabs; worker timers are not throttled.
setInterval(() => postMessage(0), 33);
