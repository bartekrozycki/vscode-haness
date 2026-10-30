import { automationCatalog } from '../features/automation/module';
import { connectionsCatalog } from '../features/connections/module';
import { monitorsCatalog } from '../features/monitors/module';
import { suggestionCatalog } from '../features/launchpad/module';
import { catalog as workItems } from '../features/work-items/catalog';
import { studioCatalog } from '../features/studio/catalog';
export const catalog = [...workItems, ...studioCatalog, ...suggestionCatalog, ...connectionsCatalog, ...monitorsCatalog, ...automationCatalog];
