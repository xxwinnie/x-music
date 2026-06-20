module.exports = {
  platform: "MockSource",
  version: "1.0.0",
  srcUrl: "https://example.test/mock-plugin.js",
  primaryKey: ["id"],
  supportedSearchType: ["music"],
  userVariables: [
    {
      key: "baseUrl",
      title: "Test media base URL"
    }
  ],
  async search(query, page, type) {
    if (type !== "music") {
      return { isEnd: true, data: [] };
    }

    return {
      isEnd: true,
      data: [
        {
          id: `mock-${page}-${query}`,
          title: `${query} Song`,
          artist: "Mock Artist",
          album: "Mock Album",
          duration: 123000,
          artwork: "https://example.test/artwork.jpg"
        }
      ]
    };
  },
  async getMediaSource(mediaItem, quality) {
    const vars = env.getUserVariables();
    return {
      url: `${vars.baseUrl}/audio/${encodeURIComponent(mediaItem.id)}.${quality === "super" ? "flac" : "mp3"}`,
      headers: {
        "x-musicfree-test": "yes"
      },
      userAgent: "OpenClawMusicFreeBridgeTest/1.0"
    };
  },
  async getLyric(mediaItem) {
    return {
      rawLrc: `[00:00.00]${mediaItem.title}`,
      translation: `[00:00.00]${mediaItem.title} translated`
    };
  }
};
