/**
 * Box client factory.
 *
 * Two auth modes, chosen by environment variables:
 *   1. Developer Token  (BOX_DEV_TOKEN)        -> fastest to demo, expires after 60 min, cannot refresh.
 *   2. Client Credentials Grant (CCG)          -> service-account auth, auto-refreshing, production-minded.
 *      Requires BOX_CLIENT_ID, BOX_CLIENT_SECRET and one of
 *      BOX_ENTERPRISE_ID (acts as the app's service account) or BOX_USER_ID (acts as a user).
 *
 * The Developer Token path is intentionally the default so the server boots with a single
 * variable during an interview demo. CCG is documented because "non-functional / auth" concerns
 * (token lifecycle, least-privilege service accounts) are exactly what an enterprise SA must own.
 */
import {
  BoxClient,
  BoxDeveloperTokenAuth,
  BoxCcgAuth,
  CcgConfig,
} from "box-typescript-sdk-gen";

export function createBoxClient(): BoxClient {
  const devToken = process.env.BOX_DEV_TOKEN;
  if (devToken && devToken.trim().length > 0) {
    const auth = new BoxDeveloperTokenAuth({ token: devToken });
    return new BoxClient({ auth });
  }

  const clientId = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const userId = process.env.BOX_USER_ID;
    const config = new CcgConfig(
      userId
      ? { clientId, clientSecret, userId }
      : { clientId, clientSecret, enterpriseId: process.env.BOX_ENTERPRISE_ID }
    );
    const auth = new BoxCcgAuth({ config });
    return new BoxClient({ auth });
  }

  throw new Error(
    "No Box credentials found. Set BOX_DEV_TOKEN (quick demo) " +
      "or BOX_CLIENT_ID + BOX_CLIENT_SECRET + BOX_ENTERPRISE_ID/BOX_USER_ID (CCG)."
  );
}
