package navigation

type Visibility string
type ItemType string
type ItemSize string

const (
	VisibilityPrivate Visibility = "private"
	VisibilityPublic  Visibility = "public"

	ItemLink   ItemType = "link"
	ItemFolder ItemType = "folder"

	Size1x1 ItemSize = "1x1"
	Size2x1 ItemSize = "2x1"
	Size2x2 ItemSize = "2x2"
)

type Item struct {
	ID              int64          `json:"id"`
	ExternalID      *string        `json:"externalId"`
	GroupID         int64          `json:"groupId"`
	ParentID        *int64         `json:"parentId"`
	Type            ItemType       `json:"type"`
	Name            string         `json:"name"`
	URL             string         `json:"url"`
	IconURL         string         `json:"iconUrl"`
	IconText        string         `json:"iconText"`
	BackgroundColor string         `json:"backgroundColor"`
	Size            ItemSize       `json:"size"`
	VisitCount      int64          `json:"visitCount"`
	SortOrder       int            `json:"sortOrder"`
	Visibility      Visibility     `json:"visibility"`
	BrowserLocal    bool           `json:"browserLocal"`
	Extra           map[string]any `json:"extra"`
	Children        []*Item        `json:"children"`
}

type Group struct {
	ID         int64          `json:"id"`
	ExternalID *string        `json:"externalId"`
	Name       string         `json:"name"`
	Icon       string         `json:"icon"`
	SortOrder  int            `json:"sortOrder"`
	Visibility Visibility     `json:"visibility"`
	Extra      map[string]any `json:"extra"`
	Items      []*Item        `json:"items"`
}

type Tree struct {
	Groups []*Group `json:"groups"`
}

type GroupInput struct {
	Name       string
	Icon       string
	Visibility Visibility
	ExternalID *string
	SortOrder  *int
	Extra      map[string]any
}

type GroupPatch struct {
	Name       *string
	Icon       *string
	Visibility *Visibility
	ExternalID **string
	SortOrder  *int
	Extra      *map[string]any
}

type ItemInput struct {
	GroupID         int64
	ParentID        *int64
	Type            ItemType
	Name            string
	URL             string
	IconURL         string
	IconText        string
	BackgroundColor string
	Size            ItemSize
	VisitCount      int64
	SortOrder       *int
	Visibility      Visibility
	BrowserLocal    *bool
	ExternalID      *string
	Extra           map[string]any
}

type ItemPatch struct {
	GroupID         *int64
	ParentID        **int64
	Type            *ItemType
	Name            *string
	URL             *string
	IconURL         *string
	IconText        *string
	BackgroundColor *string
	Size            *ItemSize
	VisitCount      *int64
	SortOrder       *int
	Visibility      *Visibility
	BrowserLocal    *bool
	ExternalID      **string
	Extra           *map[string]any
}
