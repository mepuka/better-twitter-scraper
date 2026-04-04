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
  readonly photos?: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly altText?: string;
    readonly tcoUrl: string;
  }>;
  readonly videos?: ReadonlyArray<{
    readonly id: string;
    readonly preview: string;
    readonly url: string;
    readonly tcoUrl: string;
  }>;
  readonly views?: string;
  readonly quotedResult?: any;
  readonly retweetedResult?: any;
}) => ({
  __typename: "Tweet",
  rest_id: tweet.id,
  quoted_status_result: tweet.quotedResult
    ? { result: tweet.quotedResult }
    : undefined,
  legacy: {
    id_str: tweet.id,
    full_text: tweet.text,
    created_at: tweet.createdAt,
    conversation_id_str: tweet.id,
    user_id_str: tweet.userId,
    favorite_count: 5,
    reply_count: 1,
    retweet_count: 2,
    quoted_status_id_str: tweet.quotedResult?.rest_id,
    retweeted_status_id_str: tweet.retweetedResult?.rest_id,
    retweeted_status_result: tweet.retweetedResult
      ? { result: tweet.retweetedResult }
      : undefined,
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
    extended_entities:
      tweet.photos || tweet.videos
        ? {
            media: [
              ...(tweet.photos ?? []).map((photo) => ({
                ext_alt_text: photo.altText,
                id_str: photo.id,
                media_url_https: photo.url,
                type: "photo",
                url: photo.tcoUrl,
              })),
              ...(tweet.videos ?? []).map((video) => ({
                id_str: video.id,
                media_url_https: video.preview,
                type: "video",
                url: video.tcoUrl,
                video_info: {
                  variants: [
                    {
                      bitrate: 832000,
                      content_type: "video/mp4",
                      url: video.url,
                    },
                  ],
                },
              })),
            ],
          }
        : undefined,
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

const listConversationEntry = (
  tweet: Parameters<typeof tweetResult>[0],
  entryId = `list-conversation-${tweet.id}`,
) => ({
  entryId,
  content: {
    items: [
      {
        item: {
          itemContent: {
            tweet_results: {
              result: tweetResult(tweet),
            },
          },
        },
      },
    ],
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
                    photos: [{
                      id: "photo-1",
                      url: "https://pbs.twimg.com/media/tweet1-photo.jpg",
                      altText: "A photo",
                      tcoUrl: "https://t.co/photo1",
                    }],
                    videos: [{
                      id: "video-1",
                      preview: "https://pbs.twimg.com/media/tweet1-video-thumb.jpg",
                      url: "https://video.twimg.com/ext_tw_video/tweet1.mp4",
                      tcoUrl: "https://t.co/video1",
                    }],
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
                    quotedResult: tweetResult({
                      id: "quoted-in-tweet-2",
                      text: "This is the quoted tweet",
                      username: "quoted_author",
                      name: "Quoted Author",
                      userId: "9999",
                      createdAt: "Mon Jan 18 08:00:00 +0000 2010",
                    }),
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

export const listTweetsPageOneFixture = {
  data: {
    list: {
      tweets_timeline: {
        timeline: {
          instructions: [
            {
              entries: [
                tweetEntry({
                  id: "list-tweet-1",
                  text: "First list tweet",
                  username: "xdevelopers",
                  name: "X Developers",
                  userId: "2244994945",
                  createdAt: "Mon Jan 18 11:30:00 +0000 2010",
                  hashtags: ["lists"],
                }),
                listConversationEntry({
                  id: "list-tweet-2",
                  text: "Second list tweet",
                  username: "dev_rel",
                  name: "Developer Relations",
                  userId: "3301",
                  createdAt: "Mon Jan 18 11:45:00 +0000 2010",
                  mentions: [
                    {
                      id: "55",
                      username: "helper",
                      name: "Helpful Person",
                    },
                  ],
                }),
                {
                  entryId: "cursor-bottom-list-1",
                  content: {
                    cursorType: "Bottom",
                    value: "list-cursor-1",
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
} as const;

export const listTweetsPageTwoFixture = {
  data: {
    list: {
      tweets_timeline: {
        timeline: {
          instructions: [
            {
              entries: [
                tweetEntry({
                  id: "list-tweet-3",
                  text: "Third list tweet",
                  username: "dev_advocate",
                  name: "Developer Advocate",
                  userId: "3302",
                  createdAt: "Mon Jan 18 12:00:00 +0000 2010",
                }),
                {
                  entryId: "cursor-bottom-list-2",
                  content: {
                    cursorType: "Bottom",
                    value: "list-cursor-1",
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
} as const;

const profileTimelineEntry = (profile: {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly description?: string;
  readonly website?: string;
}) => ({
  entryId: `user-${profile.id}`,
  content: {
    itemContent: {
      userDisplayType: "User",
      user_results: {
        result: {
          rest_id: profile.id,
          is_blue_verified: false,
          legacy: {
            id_str: profile.id,
            screen_name: profile.username,
            name: profile.name,
            description: profile.description,
            entities: {
              url: {
                urls: profile.website
                  ? [{ expanded_url: profile.website }]
                  : [],
              },
            },
            followers_count: 10,
            friends_count: 3,
            media_count: 1,
            statuses_count: 5,
            favourites_count: 2,
            listed_count: 0,
            profile_image_url_https:
              "https://pbs.twimg.com/profile_images/example_normal.jpeg",
            protected: false,
            can_dm: true,
          },
        },
      },
    },
  },
});

export const searchProfilesPageOneFixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                profileTimelineEntry({
                  id: "2001",
                  username: "twitterdev",
                  name: "Twitter Dev",
                  description: "Developer account",
                  website: "https://developer.x.com",
                }),
                profileTimelineEntry({
                  id: "2002",
                  username: "twitterapi",
                  name: "Twitter API",
                }),
                {
                  entryId: "cursor-bottom-search-1",
                  content: {
                    cursorType: "Bottom",
                    value: "search-cursor-1",
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
} as const;

export const searchProfilesPageTwoFixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                profileTimelineEntry({
                  id: "2003",
                  username: "twittereng",
                  name: "Twitter Engineering",
                }),
              ],
            },
          ],
        },
      },
    },
  },
} as const;

const searchTweetEntry = (tweet: Parameters<typeof tweetResult>[0]) => ({
  entryId: `tweet-${tweet.id}`,
  content: {
    itemContent: {
      tweetDisplayType: "Tweet",
      tweet_results: {
        result: tweetResult(tweet),
      },
    },
  },
});

export const searchTweetsPageOneFixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                searchTweetEntry({
                  id: "search-tweet-1",
                  text: "Top search tweet",
                  username: "tweet_searcher",
                  name: "Tweet Searcher",
                  userId: "5001",
                  createdAt: "Mon Jan 18 12:00:00 +0000 2010",
                  hashtags: ["search"],
                  urls: ["https://example.com/search-1"],
                  views: "111",
                }),
                searchTweetEntry({
                  id: "search-tweet-2",
                  text: "Second search tweet",
                  username: "tweet_searcher_two",
                  name: "Tweet Searcher Two",
                  userId: "5002",
                  createdAt: "Mon Jan 18 12:05:00 +0000 2010",
                  mentions: [
                    {
                      id: "99",
                      username: "helper",
                      name: "Helpful Person",
                    },
                  ],
                }),
                {
                  entryId: "cursor-bottom-search-tweets-1",
                  content: {
                    cursorType: "Bottom",
                    value: "search-tweets-cursor-1",
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
} as const;

export const searchTweetsPageTwoFixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                searchTweetEntry({
                  id: "search-tweet-3",
                  text: "Third search tweet",
                  username: "tweet_searcher_three",
                  name: "Tweet Searcher Three",
                  userId: "5003",
                  createdAt: "Mon Jan 18 12:10:00 +0000 2010",
                }),
              ],
            },
          ],
        },
      },
    },
  },
} as const;

export const tweetsAndRepliesPageOneFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "reply-tweet-1",
                    text: "@friend first reply",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 13:00:00 +0000 2010",
                    mentions: [
                      {
                        id: "42",
                        username: "friend",
                        name: "Friendly User",
                      },
                    ],
                  }),
                  tweetEntry({
                    id: "reply-tweet-2",
                    text: "Second reply in timeline",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 13:05:00 +0000 2010",
                  }),
                  {
                    entryId: "cursor-bottom-replies-1",
                    content: {
                      cursorType: "Bottom",
                      value: "tweets-and-replies-cursor-1",
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

export const tweetsAndRepliesPageTwoFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "reply-tweet-3",
                    text: "Third reply in timeline",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 13:10:00 +0000 2010",
                  }),
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const tweetsAndRepliesDuplicateCursorFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "reply-tweet-4",
                    text: "Duplicate cursor reply",
                    username: "nomadic_ua",
                    name: "Nomadic",
                    userId: "106037940",
                    createdAt: "Mon Jan 18 13:15:00 +0000 2010",
                  }),
                  {
                    entryId: "cursor-bottom-replies-duplicate",
                    content: {
                      cursorType: "Bottom",
                      value: "tweets-and-replies-cursor-1",
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

export const likedTweetsPageOneFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "liked-tweet-1",
                    text: "First liked tweet",
                    username: "liked_author",
                    name: "Liked Author",
                    userId: "6001",
                    createdAt: "Mon Jan 18 14:00:00 +0000 2010",
                    views: "71",
                  }),
                  tweetEntry({
                    id: "liked-tweet-2",
                    text: "Second liked tweet",
                    username: "liked_author_two",
                    name: "Liked Author Two",
                    userId: "6002",
                    createdAt: "Mon Jan 18 14:05:00 +0000 2010",
                  }),
                  {
                    entryId: "cursor-bottom-liked-1",
                    content: {
                      cursorType: "Bottom",
                      value: "liked-cursor-1",
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

export const likedTweetsPageTwoFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "liked-tweet-3",
                    text: "Third liked tweet",
                    username: "liked_author_three",
                    name: "Liked Author Three",
                    userId: "6003",
                    createdAt: "Mon Jan 18 14:10:00 +0000 2010",
                  }),
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const likedTweetsDuplicateCursorFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  tweetEntry({
                    id: "liked-tweet-4",
                    text: "Duplicate cursor liked tweet",
                    username: "liked_author_four",
                    name: "Liked Author Four",
                    userId: "6004",
                    createdAt: "Mon Jan 18 14:15:00 +0000 2010",
                  }),
                  {
                    entryId: "cursor-bottom-liked-duplicate",
                    content: {
                      cursorType: "Bottom",
                      value: "liked-cursor-1",
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

export const trendsFixture = {
  timeline: {
    instructions: [
      {},
      {
        addEntries: {
          entries: [
            {},
            {
              content: {
                timelineModule: {
                  items: [
                    {
                      item: {
                        clientEventInfo: {
                          details: {
                            guideDetails: {
                              transparentGuideDetails: {
                                trendMetadata: {
                                  trendName: "Effect",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    {
                      item: {
                        clientEventInfo: {
                          details: {
                            guideDetails: {
                              transparentGuideDetails: {
                                trendMetadata: {
                                  trendName: "TwitterScraper",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    ],
  },
} as const;

export const followersPageOneFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  profileTimelineEntry({
                    id: "3001",
                    username: "follower_one",
                    name: "Follower One",
                    description: "First follower",
                  }),
                  profileTimelineEntry({
                    id: "3002",
                    username: "follower_two",
                    name: "Follower Two",
                  }),
                  {
                    entryId: "cursor-bottom-followers-1",
                    content: {
                      cursorType: "Bottom",
                      value: "followers-cursor-1",
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

export const followersPageTwoFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  profileTimelineEntry({
                    id: "3003",
                    username: "follower_three",
                    name: "Follower Three",
                  }),
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;

export const followersDuplicateCursorFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  profileTimelineEntry({
                    id: "3004",
                    username: "follower_four",
                    name: "Follower Four",
                  }),
                  {
                    entryId: "cursor-bottom-followers-duplicate",
                    content: {
                      cursorType: "Bottom",
                      value: "followers-cursor-1",
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

export const followingPageOneFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  profileTimelineEntry({
                    id: "4001",
                    username: "following_one",
                    name: "Following One",
                  }),
                  {
                    entryId: "cursor-bottom-following-1",
                    content: {
                      cursorType: "Bottom",
                      value: "following-cursor-1",
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

export const followingPageTwoFixture = {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: [
              {
                type: "TimelineAddEntries",
                entries: [
                  profileTimelineEntry({
                    id: "4002",
                    username: "following_two",
                    name: "Following Two",
                  }),
                ],
              },
            ],
          },
        },
      },
    },
  },
} as const;

const detailUserResult = (user: {
  readonly name: string;
  readonly pinnedTweetIds?: readonly string[];
  readonly username: string;
}) => ({
  result: {
    core: {
      name: user.name,
      screen_name: user.username,
    },
    legacy: {
      name: user.name,
      pinned_tweet_ids_str: [...(user.pinnedTweetIds ?? [])],
      screen_name: user.username,
    },
    },
  });

interface DetailTweetInput {
  readonly bookmarkCount?: number;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly hashtags?: readonly string[];
  readonly id: string;
  readonly mentions?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly username: string;
  }>;
  readonly name: string;
  readonly photos?: ReadonlyArray<{
    readonly altText?: string;
    readonly id: string;
    readonly url: string;
    readonly tcoUrl: string;
  }>;
  readonly pinnedTweetIds?: readonly string[];
  readonly place?: {
    readonly fullName: string;
    readonly id: string;
    readonly name: string;
    readonly placeType: string;
  };
  readonly quotedResult?: any;
  readonly replyToId?: string;
  readonly retweetedResult?: any;
  readonly text: string;
  readonly urls?: readonly string[];
  readonly userId: string;
  readonly username: string;
  readonly versions?: readonly string[];
  readonly videos?: ReadonlyArray<{
    readonly id: string;
    readonly preview: string;
    readonly tcoUrl: string;
    readonly url: string;
  }>;
  readonly views?: string;
}

const detailTweetResult = (tweet: DetailTweetInput) => {
  const entitiesUrls = [
    ...(tweet.urls ?? []).map((url, index) => ({
      expanded_url: url,
      url: `https://t.co/link${tweet.id}${index}`,
    })),
    ...(tweet.photos ?? []).map((photo) => ({
      expanded_url: photo.tcoUrl,
      url: photo.tcoUrl,
    })),
    ...(tweet.videos ?? []).map((video) => ({
      expanded_url: video.tcoUrl,
      url: video.tcoUrl,
    })),
  ];

  return {
    __typename: "Tweet",
    core: {
      user_results: detailUserResult({
        name: tweet.name,
        ...(tweet.pinnedTweetIds
          ? { pinnedTweetIds: tweet.pinnedTweetIds }
          : {}),
        username: tweet.username,
      }),
    },
    edit_control: {
      edit_control_initial: {
        edit_tweet_ids: [...(tweet.versions ?? [tweet.id])],
      },
    },
    legacy: {
      bookmark_count: tweet.bookmarkCount ?? 9,
      conversation_id_str: tweet.conversationId,
      created_at: tweet.createdAt,
      entities: {
        hashtags: (tweet.hashtags ?? []).map((value) => ({ text: value })),
        urls: entitiesUrls,
        user_mentions: (tweet.mentions ?? []).map((mention) => ({
          id_str: mention.id,
          name: mention.name,
          screen_name: mention.username,
        })),
      },
      extended_entities:
        tweet.photos || tweet.videos
          ? {
              media: [
                ...(tweet.photos ?? []).map((photo) => ({
                  ext_alt_text: photo.altText,
                  id_str: photo.id,
                  media_url_https: photo.url,
                  type: "photo",
                  url: photo.tcoUrl,
                })),
                ...(tweet.videos ?? []).map((video) => ({
                  id_str: video.id,
                  media_url_https: video.preview,
                  type: "video",
                  url: video.tcoUrl,
                  video_info: {
                    variants: [
                      {
                        bitrate: 832000,
                        content_type: "video/mp4",
                        url: video.url,
                      },
                    ],
                  },
                })),
              ],
            }
          : undefined,
      ext_views: tweet.views ? { count: tweet.views } : undefined,
      favorite_count: 11,
      full_text: tweet.text,
      id_str: tweet.id,
      in_reply_to_status_id_str: tweet.replyToId,
      place: tweet.place
        ? {
            full_name: tweet.place.fullName,
            id: tweet.place.id,
            name: tweet.place.name,
            place_type: tweet.place.placeType,
          }
        : undefined,
      quoted_status_id_str: tweet.quotedResult?.rest_id ?? tweet.quotedResult?.legacy?.id_str,
      reply_count: 4,
      retweet_count: 2,
      retweeted_status_id_str:
        tweet.retweetedResult?.rest_id ?? tweet.retweetedResult?.legacy?.id_str,
      retweeted_status_result: tweet.retweetedResult
        ? { result: tweet.retweetedResult }
        : undefined,
      user_id_str: tweet.userId,
    },
    note_tweet: {
      note_tweet_results: {
        result: {
          text: tweet.text,
        },
      },
    },
    quoted_status_result: tweet.quotedResult
      ? { result: tweet.quotedResult }
      : undefined,
    rest_id: tweet.id,
    views: tweet.views ? { count: tweet.views } : undefined,
  };
};

const detailEntry = (
  tweet: DetailTweetInput,
  options: {
    readonly tweetDisplayType?: string;
  } = {},
) => ({
  entryId: `tweet-${tweet.id}`,
  content: {
    itemContent: {
      ...(options.tweetDisplayType
        ? { tweetDisplayType: options.tweetDisplayType }
        : {}),
      tweet_results: {
        result: detailTweetResult(tweet),
      },
    },
  },
});

const quotedTweetFixture = detailTweetResult({
  conversationId: "quoted-1",
  createdAt: "Tue Jan 19 09:00:00 +0000 2010",
  id: "quoted-1",
  name: "Quoted User",
  text: "Quoted tweet body",
  urls: ["https://example.com/quoted"],
  userId: "7001",
  username: "quoted_user",
  versions: ["quoted-1"],
  views: "25",
});

const originalTweetFixture = detailTweetResult({
  conversationId: "original-1",
  createdAt: "Tue Jan 19 10:00:00 +0000 2010",
  id: "original-1",
  name: "Original User",
  text: "Original tweet body",
  userId: "7002",
  username: "original_user",
  versions: ["original-1"],
  views: "30",
});

export const tweetDetailFixture = {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            detailEntry(
              {
                bookmarkCount: 9,
                conversationId: "thread-root",
                createdAt: "Tue Jan 19 08:00:00 +0000 2010",
                hashtags: ["thread"],
                id: "thread-root",
                mentions: [
                  {
                    id: "42",
                    name: "Friendly User",
                    username: "friend",
                  },
                ],
                name: "Nomadic",
                photos: [
                  {
                    altText: "Root photo",
                    id: "photo-1",
                    tcoUrl: "https://t.co/rootphoto",
                    url: "https://pbs.twimg.com/media/root-photo.jpg",
                  },
                ],
                pinnedTweetIds: ["thread-root"],
                place: {
                  fullName: "Austin, TX",
                  id: "place-1",
                  name: "Austin",
                  placeType: "city",
                },
                quotedResult: quotedTweetFixture,
                text: "Thread root tweet\nhttps://t.co/linkthread-root0 https://t.co/rootphoto",
                urls: ["https://example.com/root"],
                userId: "106037940",
                username: "nomadic_ua",
                versions: ["thread-root", "thread-root-edit-1"],
                videos: [
                  {
                    id: "video-1",
                    preview: "https://pbs.twimg.com/media/root-video.jpg",
                    tcoUrl: "https://t.co/rootvideo",
                    url: "https://video.twimg.com/ext_tw_video/root-video.mp4",
                  },
                ],
                views: "100",
              },
              { tweetDisplayType: "SelfThread" },
            ),
            detailEntry(
              {
                conversationId: "thread-root",
                createdAt: "Tue Jan 19 08:10:00 +0000 2010",
                id: "thread-child",
                name: "Nomadic",
                replyToId: "thread-root",
                text: "Self thread child",
                userId: "106037940",
                username: "nomadic_ua",
                versions: ["thread-child"],
                views: "80",
              },
              { tweetDisplayType: "SelfThread" },
            ),
            detailEntry({
              conversationId: "thread-root",
              createdAt: "Tue Jan 19 08:20:00 +0000 2010",
              id: "reply-1",
              name: "Reply User",
              replyToId: "thread-child",
              text: "Reply to child",
              userId: "8001",
              username: "reply_user",
              versions: ["reply-1"],
              views: "45",
            }),
            detailEntry({
              conversationId: "retweet-1",
              createdAt: "Tue Jan 19 08:30:00 +0000 2010",
              id: "retweet-1",
              name: "Retweeter",
              retweetedResult: originalTweetFixture,
              text: "RT original tweet",
              userId: "8002",
              username: "retweeter",
              versions: ["retweet-1"],
              views: "65",
            }),
            detailEntry({
              conversationId: "quoted-1",
              createdAt: "Tue Jan 19 09:00:00 +0000 2010",
              id: "quoted-1",
              name: "Quoted User",
              text: "Quoted tweet body",
              urls: ["https://example.com/quoted"],
              userId: "7001",
              username: "quoted_user",
              versions: ["quoted-1"],
              views: "25",
            }),
            detailEntry({
              conversationId: "original-1",
              createdAt: "Tue Jan 19 10:00:00 +0000 2010",
              id: "original-1",
              name: "Original User",
              text: "Original tweet body",
              userId: "7002",
              username: "original_user",
              versions: ["original-1"],
              views: "30",
            }),
          ],
        },
      ],
    },
  },
} as const;

export const malformedTweetDetailFixture = {
  data: {
    threaded_conversation_with_injections_v2: {},
  },
} as const;

export const bookmarksPageOneFixture = {
  data: {
    bookmark_timeline_v2: {
      timeline: {
        instructions: [
          {
            entries: [
              tweetEntry({
                id: "bookmark-tweet-1",
                text: "First bookmarked tweet",
                username: "bookmark_author",
                name: "Bookmark Author",
                userId: "7001",
                createdAt: "Mon Jan 18 14:00:00 +0000 2010",
                views: "42",
              }),
              tweetEntry({
                id: "bookmark-tweet-2",
                text: "Second bookmarked tweet",
                username: "bookmark_author_two",
                name: "Bookmark Author Two",
                userId: "7002",
                createdAt: "Mon Jan 18 14:05:00 +0000 2010",
              }),
              {
                entryId: "cursor-bottom-bookmark-1",
                content: {
                  cursorType: "Bottom",
                  value: "bookmark-cursor-1",
                },
              },
            ],
          },
        ],
      },
    },
  },
} as const;

export const bookmarksPageTwoFixture = {
  data: {
    bookmark_timeline_v2: {
      timeline: {
        instructions: [
          {
            entries: [
              tweetEntry({
                id: "bookmark-tweet-3",
                text: "Third bookmarked tweet",
                username: "bookmark_author_three",
                name: "Bookmark Author Three",
                userId: "7003",
                createdAt: "Mon Jan 18 14:10:00 +0000 2010",
              }),
            ],
          },
        ],
      },
    },
  },
} as const;

export const bookmarkMutationSuccessFixture = {
  data: {
    tweet_bookmark_delete: "Done",
  },
} as const;
