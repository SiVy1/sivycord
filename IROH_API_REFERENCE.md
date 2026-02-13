# Iroh 0.23 API Reference for Sivyspeak

> Ten plik jest referencją API iroh 0.23 dla agentów AI pracujących nad projektem.
> Zawiera faktyczne sygnatury metod odczytane ze źródeł crate'ów — **nie zgaduj API, korzystaj z tego pliku.**

---

## Architektura ogólna

Iroh 0.23 oferuje **dwa poziomy API**:

1. **High-level: `iroh::Node`** — zarządza wszystkim (stores, gossip, downloader, sync engine, endpoint). **To jest zalecane podejście** i używane w Sivyspeak.
2. **Low-level:** Ręczne tworzenie `Endpoint`, `Store`, `Gossip`, `Engine`, `Downloader` — wymaga precyzyjnego łączenia komponentów i jest podatne na błędy typów.

Sivyspeak używa podejścia high-level przez `iroh::node::FsNode`.

---

## 1. `iroh::node::Node<D>` — Główny punkt wejścia

```rust
// Typy aliasów
pub type MemNode = Node<iroh_blobs::store::mem::Store>;
pub type FsNode = Node<iroh_blobs::store::fs::Store>;

// Tworzenie persistent node (z danymi na dysku)
let node = iroh::node::FsNode::persistent(&path)  // -> Result<Builder<fs::Store>>
    .await?
    .secret_key(secret_key)    // opcjonalne
    .relay_mode(relay_mode)    // opcjonalne
    .spawn()                   // -> Result<Node<fs::Store>>
    .await?;

// Tworzenie in-memory node
let node = iroh::node::MemNode::memory()  // -> Builder<mem::Store>
    .spawn()
    .await?;
```

### Metody `Node<D>`:
```rust
node.node_id() -> PublicKey              // ID węzła (klucz publiczny Ed25519)
node.endpoint() -> &Endpoint            // Dostęp do endpointu sieciowego
node.client() -> &iroh::client::Iroh    // Klient RPC do interakcji z node'em
node.local_pool_handle() -> &LocalPoolHandle
node.home_relay() -> Option<RelayUrl>
node.local_address() -> Vec<SocketAddr>
node.shutdown().await -> Result<()>
node.cancel_token() -> CancellationToken
```

---

## 2. `iroh::client::Iroh` — Klient RPC

Uzyskiwany przez `node.client()`. Posiada pod-klientów:

```rust
let client = node.client();
client.docs()    -> &docs::Client      // Dokumenty (CRDT)
client.authors() -> &authors::Client   // Autorzy
client.blobs()   -> &blobs::Client     // Bloby
client.tags()    -> &tags::Client      // Tagi
client.gossip()  -> &gossip::Client    // Gossip (pub/sub)
client.net()     -> &net::Client       // Sieć
client.shutdown(force: bool).await -> Result<()>
client.status().await -> Result<NodeStatus>
```

---

## 3. `iroh::client::docs::Client` — Dokumenty

### Zarządzanie dokumentami:
```rust
// Tworzenie nowego dokumentu
let doc: Doc = client.docs().create().await?;

// Otwieranie istniejącego
let doc: Option<Doc> = client.docs().open(namespace_id).await?;

// Import z ticketu
let doc: Doc = client.docs().import(ticket).await?;

// Lista wszystkich dokumentów — zwraca Stream
let stream: impl Stream<Item = Result<(NamespaceId, CapabilityKind)>>
    = client.docs().list().await?;

// Usuwanie
client.docs().drop_doc(namespace_id).await?;
```

### Operacje na `Doc`:
```rust
let doc: Doc = ...;

// ID dokumentu
doc.id() -> NamespaceId

// Zapis danych
doc.set_bytes(author_id: AuthorId, key: impl Into<Bytes>, value: impl Into<Bytes>)
    .await -> Result<Hash>

// Zapis hasha (bez danych — dane muszą być w blob store)
doc.set_hash(author_id, key, hash, size).await -> Result<()>

// Odczyt wpisów
doc.get_many(query: impl Into<Query>).await -> Result<impl Stream<Item = Result<Entry>>>
doc.get_one(query).await -> Result<Option<Entry>>
doc.get_exact(author_id, key, include_empty).await -> Result<Option<Entry>>

// Usuwanie
doc.del(author_id, prefix).await -> Result<usize>

// Udostępnianie (tworzenie ticketu)
doc.share(mode: ShareMode, addr_options: AddrInfoOptions).await -> Result<DocTicket>

// Synchronizacja
doc.start_sync(peers: Vec<NodeAddr>).await -> Result<()>
doc.leave().await -> Result<()>

// Subskrypcja na zmiany (live events)
doc.subscribe().await -> Result<impl Stream<Item = Result<LiveEvent>>>

// Zamykanie
doc.close().await -> Result<()>
```

### `ShareMode`:
```rust
pub enum ShareMode {
    Read,
    Write,
}
```

### `AddrInfoOptions`:
```rust
pub enum AddrInfoOptions {
    Id,                    // Tylko NodeID (wymaga DNS discovery)
    RelayAndAddresses,     // Relay + adresy bezpośrednie (zalecane)
    Relay,                 // Tylko relay URL
    Addresses,             // Tylko adresy bezpośrednie
}
```

### `LiveEvent` (z `iroh::client::docs`):
```rust
pub enum LiveEvent {
    InsertLocal { entry: Entry },
    InsertRemote { from: PublicKey, entry: Entry, content_status: ContentStatus },
    ContentReady { hash: Hash },
    NeighborUp(PublicKey),
    NeighborDown(PublicKey),
    SyncFinished(SyncEvent),
    PendingContentReady,
}
```

### `Entry` (z `iroh::client::docs`):
```rust
impl Entry {
    fn author() -> AuthorId
    fn content_hash() -> Hash
    fn content_len() -> u64
    fn key() -> &[u8]
    fn timestamp() -> u64

    // Odczyt treści — WYMAGA klienta RPC jako argumentu
    async fn content_bytes(&self, client: impl Into<&RpcClient>) -> Result<Bytes>
    async fn content_reader(&self, client: impl Into<&RpcClient>) -> Result<blobs::Reader>
}

// Można przekazać &client (iroh::client::Iroh) lub &doc jako parametr client
let content: Bytes = entry.content_bytes(node.client()).await?;
let content: Bytes = entry.content_bytes(&doc).await?;
```

---

## 4. `iroh::client::authors::Client` — Autorzy

```rust
let authors = client.authors();

authors.create().await -> Result<AuthorId>
authors.default().await -> Result<AuthorId>        // Domyślny autor (tworzony automatycznie)
authors.set_default(author_id).await -> Result<()>
authors.list().await -> Result<impl Stream<Item = Result<AuthorId>>>
authors.export(author_id).await -> Result<Option<Author>>
authors.import(author: Author).await -> Result<()>
authors.delete(author_id).await -> Result<()>
```

> **WAŻNE:** `authors().default()` automatycznie tworzy autora jeśli go nie ma.
> Nie trzeba ręcznie generować `AuthorId` z losowych bajtów.

---

## 5. `iroh::client::gossip::Client` — Gossip (Pub/Sub)

```rust
let gossip = client.gossip();

// Subskrypcja na topic — zwraca (Sink, Stream)
let (sink, stream) = gossip.subscribe(
    topic: impl Into<TopicId>,
    bootstrap: impl IntoIterator<Item = impl Into<NodeId>>,
).await?;

// UWAGA: Pusty Vec wymaga adnotacji typu!
// ŹLE:  gossip.subscribe(topic, vec![])        // E0283: nie może wywnioskować typu
// DOBRZE:
gossip.subscribe(topic, Vec::<iroh_base::key::PublicKey>::new()).await?;

// Subskrypcja z opcjami
let (sink, stream) = gossip.subscribe_with_opts(topic, SubscribeOpts { ... }).await?;
```

### Typy Sink/Stream:
```rust
// Sink — do wysyłania
sink: impl Sink<SubscribeUpdate, Error = anyhow::Error>

// SubscribeUpdate to alias na iroh_gossip::net::Command
pub enum Command {
    Broadcast(Bytes),            // Do wszystkich w swarmie
    BroadcastNeighbors(Bytes),   // Tylko do bezpośrednich sąsiadów
}

// Stream — do odbioru
stream: impl Stream<Item = Result<SubscribeResponse>>
```

### Wysyłanie przez Sink:
```rust
use futures_util::SinkExt;
sink.send(iroh_gossip::net::Command::Broadcast(data.into())).await?;
```

---

## 6. `iroh_gossip::net::Gossip` — Niższy poziom (NIE UŻYWAJ w Sivyspeak)

```rust
// Tworzenie — wymaga Endpoint i AddrInfo
let gossip = Gossip::from_endpoint(endpoint, config, &addr_info);

// Dołączanie do topiku — zwraca GossipTopic
let topic_handle: GossipTopic = gossip.join(topic_id, peers).await?;
```

### `GossipTopic`:
```rust
// Rozdzielenie na sender i receiver
let (sender, receiver) = topic_handle.split();

// GossipSender:
sender.broadcast(message: Bytes).await?;
sender.broadcast_neighbors(message: Bytes).await?;
sender.join_peers(peers: Vec<NodeId>).await?;

// GossipReceiver — implementuje Stream<Item = Result<Event>>
// NIE jest iteratorem! Nie używaj .cloned() — używaj StreamExt z futures_lite
```

> **UWAGA:** `GossipTopic` NIE implementuje `Iterator`. Metoda `.cloned()` z `Iterator` nie zadziała.
> Jeśli potrzebujesz klonować, użyj `.split()` do rozdzielenia na `GossipSender` (Clone) i `GossipReceiver`.

---

## 7. `iroh_docs::store::fs::Store` — Niskopoziomowy store dokumentów

> **NIE UŻYWAJ bezpośrednio** gdy korzystasz z `iroh::Node`. Node zarządza store'm wewnętrznie.

```rust
// UWAGA: Większość metod wymaga &mut self!
Store::persistent(path) -> Result<Store>
Store::memory() -> Store

store.list_namespaces(&mut self) -> Result<impl Iterator<...>>   // &mut self!
store.get_many(&mut self, namespace, query) -> Result<QueryIterator>  // &mut self!
store.new_author(&mut self, rng) -> Result<Author>
store.import_author(&mut self, author) -> Result<()>
store.flush(&mut self) -> Result<()>
```

> Store **nie implementuje Clone**. Nie można go owinąć w `Arc` i wywoływać metod `&mut self`.
> To dlatego trzeba używać high-level API przez `iroh::Node`.

---

## 8. `iroh_blobs::store::fs::Store` — Blob store

```rust
// Tworzenie — wymaga PathBuf i Options
Store::load(root: impl AsRef<Path>).await -> io::Result<Store>
Store::new(path: PathBuf, options: Options).await -> io::Result<Store>

// Options — struct z polami publicznymi (NIE ma metody ::new()!)
pub struct Options {
    pub path: PathOptions,
    pub inline: InlineOptions,
    pub batch: BatchOptions,
}

// PathOptions
PathOptions { data_path: PathBuf, temp_path: PathBuf }

// Prościej: użyj Store::load(path) — samo tworzy Options z domyślnymi wartościami
```

> **NIE MA metody `read_to_bytes` na `Store`!**
> Aby odczytać dane bloba:
> 1. `store.get(&hash).await?` → `Option<Entry>`
> 2. `entry.data_reader().await?` → `impl AsyncSliceReader`
> 3. Albo przez klienta: `entry.content_bytes(client).await?`

### Store trait (`iroh_blobs::store::Store`):
```rust
pub trait Store: ReadableStore + MapMut + Debug {
    fn import_file(...) -> impl Future<...>
    fn import_bytes(bytes: Bytes, format: BlobFormat) -> impl Future<Output = io::Result<TempTag>>
    fn import_stream(...) -> impl Future<...>
    fn set_tag(...) -> impl Future<...>
    fn delete(...) -> impl Future<...>
    // ...
}

// WAŻNE: Store trait jest implementowany dla fs::Store (wartość), 
// ale NIE dla &fs::Store ani Arc<fs::Store>!
```

---

## 9. `iroh_blobs::downloader::Downloader`

```rust
// Tworzenie
Downloader::new<S: Store>(
    store: S,                    // Wartość Store, nie referencja!
    endpoint: Endpoint,
    rt: LocalPoolHandle,        // Z iroh_blobs::util::local_pool, NIE futures_executor!
) -> Self

// LocalPoolHandle — z iroh_blobs, nie z futures_executor!
use iroh_blobs::util::local_pool::{LocalPool, LocalPoolHandle};
let pool = LocalPool::new(Config::default());  // wymaga tokio runtime
let handle: LocalPoolHandle = pool.handle().clone();
```

> **CZĘSTY BŁĄD:** Używanie `futures_executor::LocalPool::spawner()` zamiast `iroh_blobs::util::local_pool::LocalPoolHandle`.
> To są **różne typy** — `Downloader::new` wymaga `iroh_blobs::util::local_pool::LocalPoolHandle`.

---

## 10. `iroh_docs::engine::Engine` — Niskopoziomowy silnik sync

> **NIE UŻYWAJ bezpośrednio** gdy korzystasz z `iroh::Node`.

```rust
Engine::spawn<B: iroh_blobs::store::Store>(
    endpoint: Endpoint,
    gossip: Gossip,
    replica_store: iroh_docs::store::Store,  // Wartość, nie Arc!
    bao_store: B,                            // Wartość, nie Arc!
    downloader: Downloader,
    default_author_storage: DefaultAuthorStorage,
) -> Result<Engine>

// Metody:
engine.start_sync(namespace: NamespaceId, peers: Vec<NodeAddr>).await -> Result<()>
engine.subscribe(namespace: NamespaceId).await -> Result<impl Stream<Item = Result<LiveEvent>>>
engine.leave(namespace, kill_subscribers).await -> Result<()>
engine.handle_connection(conn: Connection).await -> Result<()>
engine.shutdown().await -> Result<()>

// UWAGA: Engine NIE MA metody set_bytes! 
// set_bytes jest na iroh::client::docs::Doc, nie na Engine.
```

---

## 11. Wspólne typy

```rust
// Tożsamość
use iroh_base::key::{SecretKey, PublicKey};
use iroh_docs::AuthorId;
type NodeId = PublicKey;

// Dokumenty
use iroh_docs::NamespaceId;
use iroh_docs::DocTicket;
use iroh_docs::store::Query;
use iroh_docs::Capability;
use iroh_docs::CapabilityKind;

// Gossip
use iroh_gossip::proto::TopicId;

// Adresy
use iroh::net::NodeAddr;
use iroh_base::node_addr::AddrInfoOptions;

// Query builder
Query::all()                          // Wszystkie wpisy
Query::single_latest_per_key()        // Najnowszy wpis per klucz
Query::author(author_id)              // Wpisy danego autora
Query::key_exact(key)                 // Dokładny klucz
Query::key_prefix(prefix)             // Prefiks klucza
```

---

## 12. Najczęstsze błędy i pułapki

| Błąd | Przyczyna | Rozwiązanie |
|------|-----------|-------------|
| `cannot borrow Arc as mutable` | `Store::list_namespaces` wymaga `&mut self` | Użyj `iroh::Node` + `client.docs().list()` |
| `no method read_to_bytes on Store` | Nie istnieje taka metoda | Użyj `entry.content_bytes(client)` |
| `no method set_bytes on Engine` | `set_bytes` jest na `Doc`, nie `Engine` | Użyj `doc.set_bytes(author, key, value)` |
| `GossipTopic is not an iterator` | `GossipTopic` to `Stream`, nie `Iterator` | Użyj `.split()` lub klienta gossip |
| `Options::new() not found` | `Options` nie ma metody `new()` | Użyj `Store::load(path)` |
| `expected LocalPoolHandle, found LocalSpawner` | Zły typ pool handle | Użyj `iroh_blobs::util::local_pool::LocalPoolHandle` |
| `Store not impl for &Store / Arc<Store>` | Trait impls są na wartości | Przekaż wartość, nie referencję |
| `cannot infer type for vec![]` w gossip subscribe | Pusty vec nie ma info o typie | `Vec::<PublicKey>::new()` |
| `Store nie ma Clone` | `iroh_docs::store::fs::Store` nie impl Clone | Użyj high-level API |

---

## 13. Wzorzec użycia w Sivyspeak (zalecany)

```rust
use iroh::node::FsNode;
use iroh_base::key::SecretKey;

// 1. Tworzenie Node
let node = FsNode::persistent(&iroh_dir).await?
    .secret_key(secret_key)
    .spawn().await?;

// 2. Domyślny autor
let author_id = node.client().authors().default().await?;

// 3. Tworzenie dokumentu
let doc = node.client().docs().create().await?;
let ticket = doc.share(ShareMode::Write, AddrInfoOptions::RelayAndAddresses).await?;

// 4. Import dokumentu z ticketu
let doc = node.client().docs().import(ticket).await?;

// 5. Zapis
doc.set_bytes(author_id, "klucz", "wartość").await?;

// 6. Odczyt
let mut stream = doc.get_many(Query::all()).await?;
while let Some(Ok(entry)) = stream.next().await {
    let content = entry.content_bytes(node.client()).await?;
}

// 7. Subskrypcja zmian
let mut sub = doc.subscribe().await?;
while let Some(Ok(event)) = sub.next().await {
    match event {
        LiveEvent::InsertLocal { entry } => { ... }
        LiveEvent::InsertRemote { entry, .. } => { ... }
        _ => {}
    }
}

// 8. Gossip (voice/realtime)
use futures_util::SinkExt;
let (mut sink, mut stream) = node.client().gossip()
    .subscribe(topic_id, Vec::<PublicKey>::new()).await?;
sink.send(Command::Broadcast(data.into())).await?;
```

---

## 14. Zależności w Cargo.toml

```toml
iroh = "0.23"                                          # High-level Node API (domyślnie z fs-store)
iroh-docs = "0.23"                                     # Typy: NamespaceId, AuthorId, Query, DocTicket
iroh-gossip = "0.23"                                   # Typy: TopicId, Command
iroh-blobs = { version = "0.23", features = ["fs-store"] }  # Potrzebne dla Node<fs::Store>
iroh-base = "0.23"                                     # Typy: SecretKey, PublicKey, AddrInfoOptions
```

**Niepotrzebne** (Node zarządza nimi wewnętrznie):
- `iroh-net` — reexportowane przez `iroh`
- `futures-executor` — Node ma własny pool
- `quinn` — zarządzane przez Endpoint
- `rand` — autorzy tworzeni przez `authors().create()`
