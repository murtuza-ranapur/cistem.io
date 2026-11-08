/** App-level actions used from more than one place (toolbar, + menu, keys). */
import { exampleDoc } from '../domain/model';
import { toFile } from '../domain/document';
import { newTab } from '../store/tabs';

export const exampleFile = () => toFile(exampleDoc(), { title: 'Checkout example', created: new Date().toISOString(), updated: new Date().toISOString() });
/** Open the example as a new diagram (signed in, it's saved to the account). */
export const openExample = () => void newTab('system', exampleFile());
