-- ロール登録のメッセージ ID を、1 件の文字列から、投稿順の JSON 配列にする（20 チームごとにメッセージを分けるため）。空は、空のまま。すでに配列なら、触らない。
UPDATE `guild_settings` SET `role_message_id` = json_array(`role_message_id`) WHERE `role_message_id` IS NOT NULL AND substr(`role_message_id`, 1, 1) != '[';
