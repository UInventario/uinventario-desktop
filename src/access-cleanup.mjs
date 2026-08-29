export const SESSION_CLOSED_CHANNEL = 'uinventario:session-closed';

export async function clearOriginAccess(browserSession, origin) {
  const cookies = await browserSession.cookies.get({ url: origin });
  await Promise.all(cookies.map(({ name }) => browserSession.cookies.remove(origin, name)));
  await browserSession.clearAuthCache();
}
