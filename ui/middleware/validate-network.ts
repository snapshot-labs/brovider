export default defineNuxtRouteMiddleware(to => {
  const networkId = to.path.replace('/networks/', '');
  if (!isNumeric(networkId)) {
    return navigateTo('/networks');
  }
});

function isNumeric(str) {
  const parsed = parseInt(str, 10);
  return !isNaN(parsed) && isFinite(parsed);
}
