export const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

export const CHROME_SEC_CH_UA =
  "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"";

export const CHROME_SEC_CH_UA_MOBILE = "?0";

export const CHROME_SEC_CH_UA_PLATFORM = "\"Windows\"";

export const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-10-35-16-11-51-27-65037-43-45-18-23-5-65281-13-17613,4588-29-23-24,0";

export const CHROME_JA4R =
  "t13d1516h2_002f,0035,009c,009d,1301,1302,1303,c013,c014,c02b,c02c,c02f,c030,cca8,cca9_0005,000a,000b,000d,0012,0017,001b,0023,002b,002d,0033,44cd,fe0d,ff01_0403,0804,0401,0503,0805,0501,0806,0601";

export const CHROME_HTTP2_FINGERPRINT =
  "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p";

export const CHROME_HEADER_ORDER = [
  ":method",
  ":authority",
  ":scheme",
  ":path",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "upgrade-insecure-requests",
  "user-agent",
  "accept",
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-user",
  "sec-fetch-dest",
  "referer",
  "accept-encoding",
  "accept-language",
  "priority",
  "authorization",
  "x-csrf-token",
  "x-guest-token",
  "x-twitter-auth-type",
  "x-twitter-active-user",
  "x-twitter-client-language",
  "x-client-transaction-id",
  "x-xp-forwarded-for",
  "content-type",
  "cookie",
] as const;
