use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "channels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub description: String,
    pub position: i64,
    pub created_at: String,
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
    #[serde(default)]
    pub encrypted: bool,
    #[serde(default = "default_server_id")]
    pub server_id: String,
}

fn default_channel_type() -> String {
    "text".to_string()
}

fn default_server_id() -> String {
    "default".to_string()
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::message::Entity")]
    Message,
}

impl Related<super::message::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Message.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
