use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use std::collections::HashSet;
use uuid::Uuid;

use crate::models::{WsClientMessage, WsServerMessage};
use crate::routes::auth;
use crate::state::AppState;

const MAX_MESSAGE_LENGTH: usize = 2000;
const MAX_FIELD_LENGTH: usize = 256;
const MAX_SDP_LENGTH: usize = 65536;
const MAX_SUBSCRIPTIONS: usize = 50;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    // Try to authenticate via JWT token query param
    let auth_user = query.token.and_then(|t| {
        auth::decode_jwt(&state.jwt_secret, &t).ok()
    });

    ws.on_upgrade(move |socket| handle_socket(socket, state, auth_user))
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    auth_user: Option<auth::Claims>,
) {
    state.inc_online();

    let (user_id, user_name) = match &auth_user {
        Some(claims) => (claims.sub.clone(), claims.display_name.clone()),
        None => (Uuid::new_v4().to_string(), "Guest".to_string()),
    };
    let is_authenticated = auth_user.is_some();

    let (mut sender, mut receiver) = socket.split();
    let mut subscribed_channels: HashSet<String> = HashSet::new();
    let mut voice_user_id: Option<String> = None;

    let (client_tx, mut client_rx) = tokio::sync::mpsc::channel::<WsServerMessage>(256);

    // Send identity to client
    let _ = client_tx.send(WsServerMessage::Identity { user_id: user_id.clone() }).await;

    // Send initial voice state sync
    let voice_states = state.get_all_voice_members();
    let _ = client_tx.send(WsServerMessage::VoiceStateSync { voice_states }).await;

    // Subscribe to global broadcasts (voice presence, etc.)
    let mut global_rx = state.global_tx.subscribe();
    let global_client_tx = client_tx.clone();
    tokio::spawn(async move {
        while let Ok(msg) = global_rx.recv().await {
            if global_client_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let send_task = tokio::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to serialize WS message: {e}");
                }
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                if text.len() > MAX_SDP_LENGTH + 1024 {
                    let _ = client_tx
                        .send(WsServerMessage::Error {
                            message: "Message too large".to_string(),
                        })
                        .await;
                    continue;
                }

                let parsed: Result<WsClientMessage, _> = serde_json::from_str(&text);
                match parsed {
                    Ok(WsClientMessage::JoinChannel { channel_id }) => {
                        if channel_id.is_empty() || channel_id.len() > MAX_FIELD_LENGTH {
                            continue;
                        }
                        if subscribed_channels.len() >= MAX_SUBSCRIPTIONS {
                            continue;
                        }
                        if subscribed_channels.insert(channel_id.clone()) {
                            let tx = state.get_channel_tx(&channel_id);
                            let mut rx = tx.subscribe();
                            let client_tx = client_tx.clone();
                            let cid = channel_id.clone();
                            let uid = user_id.clone();

                            tokio::spawn(async move {
                                while let Ok(msg) = rx.recv().await {
                                    let should_send = match &msg {
                                        WsServerMessage::NewMessage { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::UserJoined { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::UserLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoicePeerJoined { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoicePeerLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceMembers { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceTalking { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceStatusUpdate { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceOffer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::VoiceAnswer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::IceCandidate { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        _ => true,
                                    };
                                    if should_send {
                                        if client_tx.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            });
                        }
                    }
                    Ok(WsClientMessage::LeaveChannel { channel_id }) => {
                        subscribed_channels.remove(&channel_id);
                    }
                    Ok(WsClientMessage::SendMessage {
                        channel_id,
                        content,
                        ..
                    }) => {
                        // REQUIRE AUTH for sending messages
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required to send messages".to_string(),
                            }).await;
                            continue;
                        }

                        let content = content.trim().to_string();
                        if content.is_empty() || content.len() > MAX_MESSAGE_LENGTH {
                            continue;
                        }
                        if channel_id.is_empty() {
                            continue;
                        }

                        let msg_id = Uuid::new_v4().to_string();
                        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

                        if let Err(e) = sqlx::query(
                            "INSERT INTO messages (id, channel_id, user_id, user_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        )
                        .bind(&msg_id)
                        .bind(&channel_id)
                        .bind(&user_id)
                        .bind(&user_name)
                        .bind(&content)
                        .bind(&now)
                        .execute(&state.db)
                        .await {
                            tracing::error!("Failed to save message: {e}");
                            continue;
                        }

                        let avatar_url: Option<String> = match &auth_user {
                            Some(claims) => {
                                // Fetch latest avatar_url from DB
                                sqlx::query_scalar::<_, Option<String>>("SELECT avatar_url FROM users WHERE id = ?")
                                    .bind(&claims.sub)
                                    .fetch_one(&state.db)
                                    .await
                                    .unwrap_or(None)
                            }
                            None => None,
                        };

                        let broadcast_msg = WsServerMessage::NewMessage {
                            id: msg_id,
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                            avatar_url,
                            content,
                            created_at: now,
                        };

                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(broadcast_msg);
                    }

                    // ─── Voice signaling ───
                    Ok(WsClientMessage::JoinVoice { channel_id, .. }) => {
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required for voice".to_string(),
                            }).await;
                            continue;
                        }
                        if channel_id.is_empty() {
                            continue;
                        }

                        voice_user_id = Some(user_id.clone());

                        if subscribed_channels.len() < MAX_SUBSCRIPTIONS && subscribed_channels.insert(channel_id.clone()) {
                            let tx = state.get_channel_tx(&channel_id);
                            let mut rx = tx.subscribe();
                            let client_tx = client_tx.clone();
                            let cid = channel_id.clone();
                            let uid = user_id.clone();

                            tokio::spawn(async move {
                                while let Ok(msg) = rx.recv().await {
                                    let should_send = match &msg {
                                        WsServerMessage::VoicePeerJoined { user_id, channel_id, .. } => {
                                            channel_id == &cid && user_id != &uid
                                        }
                                        WsServerMessage::VoicePeerLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceMembers { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceTalking { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceStatusUpdate { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceOffer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::VoiceAnswer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::IceCandidate { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        _ => true,
                                    };
                                    if should_send {
                                        if client_tx.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            });
                        }

                        let members = state.join_voice(&channel_id, &user_id, &user_name, false, false);

                        let _ = client_tx.send(WsServerMessage::VoiceMembers {
                            channel_id: channel_id.clone(),
                            members,
                        }).await;

                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoicePeerJoined {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoicePeerJoined {
                            channel_id,
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                        });
                    }
                    Ok(WsClientMessage::LeaveVoice { channel_id, .. }) => {
                        state.leave_voice(&channel_id, &user_id);
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoicePeerLeft {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoicePeerLeft {
                            channel_id,
                            user_id: user_id.clone(),
                        });
                    }
                    Ok(WsClientMessage::VoiceOffer { channel_id, target_user_id, from_user_id: _, sdp }) => {
                        if sdp.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceOffer {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            sdp,
                        });
                    }
                    Ok(WsClientMessage::VoiceAnswer { channel_id, target_user_id, from_user_id: _, sdp }) => {
                        if sdp.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceAnswer {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            sdp,
                        });
                    }
                    Ok(WsClientMessage::IceCandidate { channel_id, target_user_id, from_user_id: _, candidate }) => {
                        if candidate.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::IceCandidate {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            candidate,
                        });
                    }
                    Ok(WsClientMessage::VoiceTalking { channel_id, user_id: _, talking }) => {
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceTalking {
                            channel_id,
                            user_id: user_id.clone(),
                            talking,
                        });
                    }
                    Ok(WsClientMessage::VoiceStatusUpdate { channel_id, user_id: _, is_muted, is_deafened }) => {
                        state.update_voice_status(&channel_id, &user_id, is_muted, is_deafened);
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceStatusUpdate {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            is_muted,
                            is_deafened,
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoiceStatusUpdate {
                            channel_id,
                            user_id: user_id.clone(),
                            is_muted,
                            is_deafened,
                        });
                    }

                    Err(_) => {
                        let _ = client_tx
                            .send(WsServerMessage::Error {
                                message: "Invalid message format".to_string(),
                            })
                            .await;
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup: remove from all voice channels on disconnect
    if voice_user_id.is_some() {
        let left = state.leave_all_voice(&user_id);
        for (channel_id, uid) in left {
            let tx = state.get_channel_tx(&channel_id);
            let _ = tx.send(WsServerMessage::VoicePeerLeft { channel_id: channel_id.clone(), user_id: uid.clone() });

            // Global broadcast
            let _ = state.global_tx.send(WsServerMessage::VoicePeerLeft { channel_id, user_id: uid });
        }
    }

    state.dec_online();
    send_task.abort();
}
