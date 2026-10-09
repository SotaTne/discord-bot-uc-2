import { Chip, Group } from "@mantine/core";
import type { MockUser } from "../mockState";

/** 実行者。複数選べる。コマンドは、選んだ全員として、順に実行する */
export function UserPicker({ users, selected, onChange }: { users: MockUser[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return (
    <Chip.Group multiple value={selected} onChange={onChange}>
      <Group gap={6} role="group" aria-label="実行者">
        {users.map((user) => (
          <Chip key={user.id} value={user.id} size="sm">
            {user.username}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}
