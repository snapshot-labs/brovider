export default defineNuxtRouteMiddleware(to => {
  const networkId = to.path.replace('/networks/', '');
  if (!isNumeric(networkId)) {
    return navigateTo('/networks');
  }
});

function isNumeric(str) {
  return /^\d+$/.test(str);
}
