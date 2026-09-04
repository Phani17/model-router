import { describe, expect, it, vi } from 'vitest';
import { parseSseStream } from './sse';

function streamChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}

describe('parseSseStream', () => {
  it('parses frames split across arbitrary network chunks', async () => {
    const onMessage = vi.fn();
    await parseSseStream(streamChunks([
      'event: model_sta',
      'rted\ndata: {"type":"model_started",',
      '"model":"a"}\n\nevent: comparison_completed\n',
      'data: {"type":"comparison_completed"}\n\n'
    ]), onMessage);

    expect(onMessage).toHaveBeenNthCalledWith(1, {
      event: 'model_started',
      data: { type: 'model_started', model: 'a' }
    });
    expect(onMessage).toHaveBeenNthCalledWith(2, {
      event: 'comparison_completed',
      data: { type: 'comparison_completed' }
    });
  });

  it('supports CRLF and multi-line data fields', async () => {
    const messages: unknown[] = [];
    await parseSseStream(streamChunks([
      'event: message\r',
      '\ndata: {"value":\r\ndata: 42}\r',
      '\n\r\n'
    ]), message => messages.push(message));

    expect(messages).toEqual([{ event: 'message', data: { value: 42 } }]);
  });
});
