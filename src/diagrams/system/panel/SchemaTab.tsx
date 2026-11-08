/** A component's schema tab: endpoints (with headers and bodies), tables, a topic or a message. */
import { METHODS, detailOf, type Node } from '../../../domain/model';
import { parseAvro, COMMON_HEADERS, HEADER_VALUES } from '../../../domain/fields';
import { AddButton, DataList, NumberField, RemoveButton, SelectField, TextField } from './controls';
import { editItem } from './paths';
import { FieldEditor } from './FieldEditor';
import { TablesEditor } from './TablesEditor';

export function SchemaTab({ n }: { n: Node }) {
  const dk = detailOf(n);
  return (
    <div className="tab">
      {dk === 'endpoints' && <Endpoints n={n} />}
      {dk === 'tables' && <TablesEditor n={n} />}
      {dk === 'message' && <Message n={n} />}
      {dk === 'topic' && <Topic n={n} />}
    </div>
  );
}

/** Header values worth suggesting for a header name (matching case-insensitively too). */
const headerValues = (k: string) => [...new Set([...(HEADER_VALUES[k] || []), ...(HEADER_VALUES[Object.keys(HEADER_VALUES).find(x => x.toLowerCase() === k.toLowerCase()) || ''] || [])])];

function Endpoints({ n }: { n: Node }) {
  const eps = n.endpoints || [];
  const add = () => editItem(it => { (it.endpoints ??= []).push({ method: 'GET', path: '/v1/', headers: [], req: '', res: '' }); });
  // removing an endpoint renumbers the edges that call the ones after it
  const remove = (i: number) => editItem((it, d) => {
    it.endpoints.splice(i, 1);
    for (const e of d.edges) if (e.to === it.id && e.endpoint != null) { if (e.endpoint === i) e.endpoint = null; else if (e.endpoint > i) e.endpoint--; }
  });
  return (
    <section className="list">
      <h3>Endpoints <span className="spacer" /><AddButton action="add-endpoint" label="endpoint" onClick={add} /></h3>
      {eps.map((ep, i) => (
        <div className="item" key={i}>
          <div className="row ep">
            <SelectField path={`endpoints.${i}.method`} label="method" value={ep.method} options={METHODS} className="method" />
            <TextField path={`endpoints.${i}.path`} label="path" value={ep.path} placeholder="/v1/resource/{id}" />
            <RemoveButton action={`rm-endpoint:${i}`} onClick={() => remove(i)} />
          </div>
          <div className="sub">Headers <span className="spacer" /><AddButton action={`add-header:${i}`} label="header" onClick={() => editItem(it => { (it.endpoints[i].headers ??= []).push({ k: '', v: '' }); })} /></div>
          {(ep.headers || []).map((h, j) => (
            <div className="row hdr" key={j}>
              <TextField path={`endpoints.${i}.headers.${j}.k`} label="name" value={h.k} list="hdrNames" placeholder="Header-Name" />
              <TextField path={`endpoints.${i}.headers.${j}.v`} label="value" value={h.v} list={`hv-${i}-${j}`} placeholder="value" />
              <RemoveButton action={`rm-header:${i}:${j}`} onClick={() => editItem(it => { it.endpoints[i].headers.splice(j, 1); })} />
              <DataList id={`hv-${i}-${j}`} values={headerValues(h.k)} />
            </div>
          ))}
          <div className="row stack">
            <FieldEditor nodeId={n.id} path={`endpoints.${i}.req`} label="request body" text={ep.req} kind="json" />
            <FieldEditor nodeId={n.id} path={`endpoints.${i}.res`} label="response body" text={ep.res} kind="json" />
          </div>
        </div>
      ))}
      {!eps.length && <p className="empty">No endpoints yet.</p>}
      <DataList id="hdrNames" values={COMMON_HEADERS} />
    </section>
  );
}

const keyOptions = (n: Node) => (parseAvro(n.schema ?? '')?.fields ?? []).map(f => f.name).filter(Boolean);

function Message({ n }: { n: Node }) {
  return (
    <section className="list">
      <h3>Message</h3>
      {n.fifo && (
        <div className="props">
          <TextField path="key" label="Message group key" wide value={n.key ?? ''} list="tkeys" placeholder="e.g. merchantId" />
          <DataList id="tkeys" values={keyOptions(n)} />
        </div>
      )}
      <div className="row stack"><FieldEditor nodeId={n.id} path="schema" label="Message schema (Avro)" text={n.schema ?? ''} kind="avro" /></div>
    </section>
  );
}

function Topic({ n }: { n: Node }) {
  return (
    <section className="list">
      <h3>Topic</h3>
      <div className="props">
        <NumberField path="partitions" label="Partitions" value={n.partitions} min={1} />
        <TextField path="key" label="Partition key" value={n.key ?? ''} list="tkeys" placeholder="e.g. paymentId" />
        <DataList id="tkeys" values={keyOptions(n)} />
        <TextField path="cluster" label="Cluster" wide value={n.cluster ?? ''} placeholder="optional, e.g. msk-payments" />
      </div>
      <div className="row stack"><FieldEditor nodeId={n.id} path="schema" label="Value schema (Avro)" text={n.schema ?? ''} kind="avro" /></div>
    </section>
  );
}
