import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { ingestLocations, RUN_LOCATION_TASK } from './run-recorder';

type LocationTaskData = { locations?: Location.LocationObject[] };

// Expo starts a headless JS bundle for background delivery, so this definition
// must remain at module scope and the module must be imported by index.ts.
if (!TaskManager.isTaskDefined(RUN_LOCATION_TASK)) {
  TaskManager.defineTask<LocationTaskData>(RUN_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await ingestLocations(data.locations);
  });
}
