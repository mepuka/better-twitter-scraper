export const profileFixture = {
  data: {
    user: {
      result: {
        __typename: "User",
        rest_id: "106037940",
        is_blue_verified: false,
        legacy: {
          created_at: "Mon Jan 18 08:49:30 +0000 2010",
          description: "nothing",
          entities: {
            url: {
              urls: [
                {
                  expanded_url: "https://nomadic.name",
                },
              ],
            },
          },
          followers_count: 100,
          friends_count: 25,
          media_count: 8,
          statuses_count: 99,
          favourites_count: 7,
          listed_count: 2,
          name: "Nomadic",
          location: "Ukraine",
          pinned_tweet_ids_str: [],
          profile_banner_url:
            "https://pbs.twimg.com/profile_banners/106037940/1541084318",
          profile_image_url_https:
            "https://pbs.twimg.com/profile_images/436075027193004032/XlDa2oaz_normal.jpeg",
          protected: false,
          screen_name: "nomadic_ua",
          can_dm: true,
        },
        core: {
          created_at: "Mon Jan 18 08:49:30 +0000 2010",
          name: "Nomadic",
          screen_name: "nomadic_ua",
        },
        avatar: {
          image_url:
            "https://pbs.twimg.com/profile_images/436075027193004032/XlDa2oaz_normal.jpeg",
        },
        location: {
          location: "Ukraine",
        },
      },
    },
  },
} as const;

const tweetResult = (tweet: {
  readonly id: string;
  readonly text: string;
  readonly username: string;
  readonly name: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly urls?: readonly string[];
  readonly hashtags?: readonly string[];
  readonly mentions?: ReadonlyArray<{
    readonly id: string;
    readonly username: string;
    readonly name: string;
  }>;
  readonly views?: string;
}) => ({
  __typename: "Tweet",
  rest_id: tweet.id,
  legacy: {
    id_str: tweet.id,
    full_text: tweet.text,
    created_at: tweet.createdAt,
    conversation_id_str: tweet.id,
    user_id_str: tweet.userId,
    favorite_count: 5,
    reply_count: 1,
    retweet_count: 2,
    entities: {
      hashtags: (tweet.hashtags ?? []).map((value) => ({ text: value })),
      urls: (tweet.urls ?? []).map((value) => ({
        expanded_url: value,
      })),
      user_mentions: (tweet.mentions ?? []).map((mention) => ({
        id_str: mention.id,
        screen_name: mention.username,
        name: mention.name,
      })),
    },
  },
  core: {
    user_results: {
      result: {
        legacy: {
          screen_name: tweet.username,
          name: tweet.name,
        },
        core: {
          screen_name: tweet.username,
          name: tweet.name,
        },
      },
    },
  },
  views: tweet.views ? { count: tweet.views } : undefined,
});

const tweetEntry = (tweet: Parameters<typeof tweetResult>[0]) => ({
  entryId: `tweet-${tweet.id}`,
  content: {
    itemContent: {
      tweet_results: {
        result: tweetResult(tweet),
      },
    },
  },
});

export const tweetsPageOneFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "tweet-1",
                    text: "First tweet",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 09:00:00 +0000 2010",
                    hashtags: ["slice1"],
                    urls: ["https://example.com/1"],
                    views: "17",
                  }),
                  tweetEntry({
                    id: "tweet-2",
                    text: "Second tweet",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 10:00:00 +0000 2010",
                    mentions: [
                      {
                        id: "42",
                        username: "friend",
                        name: "Friendly User",
                      },
                    ],
                  }),
                  {
                    entryId: "cursor-bottom-1",
                    content: {
                      cursorType: "Bottom",
                      value: "cursor-1",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const tweetsPageTwoFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "tweet-3",
                    text: "Third tweet",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 11:00:00 +0000 2010",
                  }),
                  {
                    entryId: "cursor-bottom-2",
                    content: {
                      cursorType: "Bottom",
                      value: "cursor-1",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;
