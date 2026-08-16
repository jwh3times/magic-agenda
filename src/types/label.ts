/** A Board-owned task classification. Unlabeled is represented by a null Task.labelId. */
export interface Label {
  id: string
  boardId: string
  name: string
  dotColor: string
  position: number
}
