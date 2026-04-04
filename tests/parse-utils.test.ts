import { describe, expect, it } from "vitest";

import { reconstructTweetHtml } from "../src/parse-utils";
import { TweetPhoto, TweetVideo } from "../src/tweet-detail-model";

const emptyLegacy = {
  entities: {
    urls: [],
  },
  extended_entities: {
    media: [],
  },
} as const;

describe("reconstructTweetHtml", () => {
  it("escapes raw html in tweet text while preserving generated links", () => {
    const html = reconstructTweetHtml(
      emptyLegacy as any,
      `<img src=x onerror=alert(1)> hello #tag @friend $TSLA`,
      [],
      [],
    );

    expect(html).not.toContain(`<img src=x onerror=alert(1)>`);
    expect(html).toContain(`&lt;img src=x onerror=alert(1)&gt; hello`);
    expect(html).toContain(`<a href="https://x.com/hashtag/tag">#tag</a>`);
    expect(html).toContain(`<a href="https://x.com/friend">@friend</a>`);
    expect(html).toContain(`<a href="https://x.com/search?q=%24TSLA">$TSLA</a>`);
  });

  it("does not emit unsafe href or src attributes from tweet data", () => {
    const html = reconstructTweetHtml(
      {
        entities: {
          urls: [
            {
              url: "https://t.co/AAAAAAAAAA",
              expanded_url: "javascript:alert(1)",
            },
          ],
        },
        extended_entities: {
          media: [
            {
              id_str: "media-1",
              media_url_https: "javascript:alert(2)",
              type: "photo",
              url: "https://t.co/BBBBBBBBBB",
            },
          ],
        },
      } as any,
      "links https://t.co/AAAAAAAAAA media https://t.co/BBBBBBBBBB",
      [
        new TweetPhoto({
          id: "photo-1",
          url: "javascript:alert(3)",
        }),
      ],
      [
        new TweetVideo({
          id: "video-1",
          preview: "javascript:alert(4)",
        }),
      ],
    );

    expect(html).not.toContain(`href="javascript:alert(1)"`);
    expect(html).not.toContain(`src="javascript:alert(2)"`);
    expect(html).not.toContain(`src="javascript:alert(3)"`);
    expect(html).not.toContain(`src="javascript:alert(4)"`);
    expect(html).toContain(`https://t.co/AAAAAAAAAA`);
    expect(html).toContain(`https://t.co/BBBBBBBBBB`);
  });
});
