#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(WatchSession, RCTEventEmitter)
RCT_EXTERN_METHOD(updateRun:(NSDictionary *)snapshot)
RCT_EXTERN_METHOD(pendingWatchRuns:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearWatchRun:(NSString *)sourceRecordId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
@end
