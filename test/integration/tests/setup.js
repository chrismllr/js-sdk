before(() => {
  console.log('----------------------------> setup - line 2');
  Kinvey.init({
    appKey: externalConfig.appKey,
    appSecret: externalConfig.appSecret
  });
});
