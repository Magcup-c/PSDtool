#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PsdLayerInfo {
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
    pub children: Option<Vec<PsdLayerInfo>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PsdMetadata {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PsdLayerInfo>,
}
