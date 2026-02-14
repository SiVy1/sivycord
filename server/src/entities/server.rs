use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "servers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub owner_id: String,
    pub join_sound_url: Option<String>,
    pub leave_sound_url: Option<String>,
    pub sound_chance: i64,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::server_member::Entity")]
    ServerMember,
    #[sea_orm(has_many = "super::channel::Entity")]
    Channel,
}

impl Related<super::server_member::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ServerMember.def()
    }
}

impl Related<super::channel::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Channel.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
