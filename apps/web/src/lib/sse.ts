/**
 * Reads a `text/event-stream` response body and calls `onEvent` with each
 * event's parsed JSON `data`. For streams EventSource can't open (POST).
 * Comment lines (heartbeats) carry no data and are skipped.
 */
export async function readSse(
  response: Response,
  onEvent: (data: unknown) => void,
): Promise<void> {
  if (!response.body) throw new Error("The response has no body to stream.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
  }
}
